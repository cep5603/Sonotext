import os
os.environ["HF_HOME"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hub")

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import io
import re
import json
import soundfile as sf
import numpy as np
import logging
import uuid
import asyncio
from model_manager import model_manager
from qwen_tts_manager import qwen3_manager
from voice_profiles import voice_profile_manager, DEFAULT_REFERENCE_TEXT
from pdf_processor import extract_text_from_pdf
from history_manager import history_manager
from project_manager import project_manager
import llm_service
import alignment_service

app = FastAPI(title="Sonotext Local API")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount outputs directory
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

class GenerateRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0
    lang: str | None = None  # None means auto-detect from voice
    engine: str = "kokoro"  # "kokoro" or "qwen3"
    instruct: str | None = None  # Qwen3-TTS emotion/style instruction
    voice_profile_id: str | None = None  # Custom voice profile for cloning
    chunk_size: int = 500  # Max characters per chunk for TTS

class CleanupRequest(BaseModel):
    text: str

def split_into_chunks(text: str, max_chars: int = 500) -> list[str]:
    """Split text into chunks at sentence boundaries."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        if len(current_chunk) + len(sentence) <= max_chars:
            current_chunk += (" " if current_chunk else "") + sentence
        else:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = sentence
    
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks if chunks else [text]

def crossfade_chunks(chunks: list[np.ndarray], sample_rate: int, crossfade_ms: int = 200) -> np.ndarray:
    """
    Concatenate audio chunks with crossfade blending to smooth transitions.
    
    Args:
        chunks: List of audio arrays (numpy float32)
        sample_rate: Audio sample rate in Hz
        crossfade_ms: Crossfade duration in milliseconds
    
    Returns:
        Single concatenated audio array with crossfaded transitions
    """
    if not chunks:
        return np.array([], dtype=np.float32)
    if len(chunks) == 1:
        return chunks[0]
    
    crossfade_samples = int(sample_rate * crossfade_ms / 1000)
    
    # Normalize each chunk to prevent volume jumps
    normalized = []
    for chunk in chunks:
        if len(chunk) > 0:
            peak = np.max(np.abs(chunk))
            if peak > 0:
                chunk = chunk / peak * 0.95  # Normalize to 95% to prevent clipping
        normalized.append(chunk)
    
    # Build output with crossfades
    result = normalized[0].copy()
    
    for i in range(1, len(normalized)):
        current = normalized[i]
        
        if len(result) < crossfade_samples or len(current) < crossfade_samples:
            # Chunks too short for crossfade, just concatenate
            result = np.concatenate([result, current])
        else:
            # Create crossfade: fade out end of previous, fade in start of current
            fade_out = np.linspace(1.0, 0.0, crossfade_samples, dtype=np.float32)
            fade_in = np.linspace(0.0, 1.0, crossfade_samples, dtype=np.float32)
            
            # Blend the overlapping region
            overlap = result[-crossfade_samples:] * fade_out + current[:crossfade_samples] * fade_in
            
            # Concatenate: previous (minus overlap) + blended overlap + current (minus overlap)
            result = np.concatenate([
                result[:-crossfade_samples],
                overlap,
                current[crossfade_samples:]
            ])
    
    return result

@app.get("/api/voices")
def get_voices(engine: str = "kokoro"):
    """Return available voice IDs for the specified engine."""
    if engine == "qwen3":
        return {"voices": qwen3_manager.get_voices()}
    if not model_manager.voices:
        return {"voices": []}
    return {"voices": model_manager.voices}


@app.get("/api/engines")
def get_engines():
    """Return available TTS engines and their status."""
    return {
        "engines": [
            {
                "id": "kokoro",
                "name": "Kokoro",
                "description": "Fast, lightweight TTS (82M params)",
                "loaded": True,  # Kokoro is always loaded
            },
            {
                "id": "qwen3",
                "name": "Qwen3-TTS",
                "description": "Expressive, multilingual TTS (1.7B params)",
                "loaded": qwen3_manager.is_loaded,
            },
        ]
    }


@app.get("/api/qwen3/info")
def get_qwen3_info():
    """Get Qwen3-TTS model info."""
    return qwen3_manager.get_model_info()


@app.post("/api/qwen3/load")
def load_qwen3_model():
    """Load a Qwen3-TTS model."""
    try:
        qwen3_manager.load_model("custom-1.7B")
        return qwen3_manager.get_model_info()
    except Exception as e:
        logging.error(f"Failed to load Qwen3-TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/qwen3/unload")
def unload_qwen3_model():
    """Unload the Qwen3-TTS model to free VRAM."""
    qwen3_manager.unload_model()
    return {"status": "success"}


# Voice Profile API Endpoints

@app.get("/api/voice-profiles")
def list_voice_profiles():
    """List all saved voice profiles."""
    profiles = voice_profile_manager.list_profiles()
    return {
        "profiles": [p.to_dict() for p in profiles]
    }


@app.get("/api/voice-profiles/{profile_id}")
def get_voice_profile(profile_id: str):
    """Get a specific voice profile."""
    profile = voice_profile_manager.get_profile(profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Voice profile not found")
    return profile.to_dict()


class CreateVoiceDesignRequest(BaseModel):
    name: str
    description: str  # Voice design instruction
    language: str = "Auto"


@app.post("/api/voice-profiles/design")
async def create_voice_profile_from_design(req: CreateVoiceDesignRequest):
    """
    Create a new voice profile from natural language description.
    
    Requires loading the VoiceDesign model, generating reference audio,
    then switching to Base model for future cloning.
    """
    try:
        # Load VoiceDesign model
        qwen3_manager.load_model("design-1.7B")
        
        # Generate reference audio
        reference_audio, sr = qwen3_manager.generate_voice_design(
            text=DEFAULT_REFERENCE_TEXT,
            voice_description=req.description,
            language=req.language,
        )
        
        # Create and save profile
        profile = voice_profile_manager.create_from_design(
            name=req.name,
            description=req.description,
            reference_audio=reference_audio,
            sample_rate=sr,
            reference_text=DEFAULT_REFERENCE_TEXT,
            language=req.language,
        )
        
        return profile.to_dict()
        
    except Exception as e:
        logging.error(f"Failed to create voice profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/voice-profiles/upload")
async def create_voice_profile_from_upload(
    name: str = Form(...),
    transcript: str = Form(...),
    language: str = Form("Auto"),
    audio: UploadFile = File(...),
):
    """
    Create a voice profile from uploaded audio file.
    
    The audio should be a short (~10 second) sample with the transcript provided.
    """
    try:
        audio_data = await audio.read()
        
        profile = voice_profile_manager.create_from_upload(
            name=name,
            audio_data=audio_data,
            transcript=transcript,
            language=language,
        )
        
        return profile.to_dict()
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.error(f"Failed to create voice profile from upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/voice-profiles/{profile_id}")
def delete_voice_profile(profile_id: str):
    """Delete a voice profile."""
    success = voice_profile_manager.delete_profile(profile_id)
    if not success:
        raise HTTPException(status_code=404, detail="Voice profile not found")
    return {"status": "success"}


@app.get("/api/voice-profiles/{profile_id}/reference-audio")
async def get_reference_audio(profile_id: str):
    """Serve the reference audio file for a voice profile (for preview/playback)."""
    ref = voice_profile_manager.get_reference_audio(profile_id)
    if ref is None:
        raise HTTPException(status_code=404, detail="Reference audio not found")
    
    audio, sr = ref
    buffer = io.BytesIO()
    sf.write(buffer, audio, sr, format='WAV')
    buffer.seek(0)
    
    return StreamingResponse(
        buffer,
        media_type="audio/wav",
        headers={"Content-Disposition": f"inline; filename=reference-{profile_id[:8]}.wav"}
    )


class RenameVoiceProfileRequest(BaseModel):
    name: str


@app.patch("/api/voice-profiles/{profile_id}")
def rename_voice_profile(profile_id: str, req: RenameVoiceProfileRequest):
    """Rename a voice profile."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    
    profile = voice_profile_manager.rename_profile(profile_id, req.name.strip())
    if not profile:
        raise HTTPException(status_code=404, detail="Voice profile not found")
    return profile.to_dict()


class ReorderVoiceProfilesRequest(BaseModel):
    order: list[str]


@app.put("/api/voice-profiles/order")
def reorder_voice_profiles(req: ReorderVoiceProfilesRequest):
    """Update the display order of voice profiles."""
    voice_profile_manager.save_order(req.order)
    return {"status": "success"}

@app.post("/api/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = "eng",
):
    """
    Transcribe an audio file using faster-whisper.
    
    Uses CTranslate2 backend for 4x faster inference and lower VRAM.
    Used for generating transcripts for voice cloning reference audio.
    """
    import tempfile
    import torch
    from faster_whisper import WhisperModel
    
    try:
        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        try:
            # Load faster-whisper model
            logging.info("Loading faster-whisper model for transcription...")
            device = "cuda" if torch.cuda.is_available() else "cpu"
            compute_type = "float16" if device == "cuda" else "int8"
            
            model = WhisperModel("small", device=device, compute_type=compute_type)
            
            # Map language codes
            lang_map = {
                "eng": "en",
                "cmn": "zh", 
                "jpn": "ja",
                "kor": "ko",
                "fra": "fr",
                "deu": "de",
                "spa": "es",
                "por": "pt",
                "rus": "ru",
                "ita": "it",
            }
            whisper_lang = lang_map.get(language, "en")
            
            # Transcribe
            segments, info = model.transcribe(tmp_path, language=whisper_lang)
            transcript = " ".join([segment.text for segment in segments]).strip()
            
            # Cleanup model
            del model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logging.info("faster-whisper model unloaded")
            
            return {"transcript": transcript}
            
        finally:
            # Clean up temp file
            import os
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
    except Exception as e:
        logging.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PreviewVoiceRequest(BaseModel):
    text: str = "Hello, this is a preview of my voice."


@app.post("/api/voice-profiles/{profile_id}/preview")
async def preview_voice_profile(profile_id: str, req: PreviewVoiceRequest):
    """
    Generate a short preview using a voice profile.
    
    Returns the audio as a WAV file.
    """
    profile = voice_profile_manager.get_profile(profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Voice profile not found")
    
    ref_audio = voice_profile_manager.get_reference_audio(profile_id)
    if ref_audio is None:
        raise HTTPException(status_code=404, detail="Reference audio not found")
    
    try:
        # Load Base model for cloning
        qwen3_manager.load_model("base-1.7B")
        
        # Create voice clone prompt
        voice_clone_prompt = qwen3_manager.create_voice_clone_prompt(
            ref_audio=ref_audio[0],
            ref_audio_sr=ref_audio[1],
            ref_text=profile.reference_text,
        )
        
        # Generate preview audio
        preview_audio, sr = qwen3_manager.generate_voice_clone(
            text=req.text,
            voice_clone_prompt=voice_clone_prompt,
            language=profile.language,
        )
        
        # Return as WAV
        buffer = io.BytesIO()
        sf.write(buffer, preview_audio, sr, format='WAV')
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=preview-{profile_id[:8]}.wav"}
        )
        
    except Exception as e:
        logging.error(f"Failed to generate preview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/llm-status")
def get_llm_status():
    """Check if LM Studio is available and get current model."""
    available = llm_service.check_llm_available()
    return {
        "available": available,
        "currentModel": llm_service.get_current_model() if available else None
    }

@app.get("/api/llm-models")
def get_llm_models():
    """Get list of available LLMs."""
    models = llm_service.get_available_models()
    return {"models": models, "currentModel": llm_service.get_current_model()}

class SetModelRequest(BaseModel):
    model: str

@app.post("/api/llm-model")
def set_llm_model(req: SetModelRequest):
    """Set the LLM to use."""
    llm_service.set_current_model(req.model)
    return {"status": "success", "model": req.model}

@app.get("/api/llm-model-status")
def get_llm_model_status():
    """Get the loading status of the current model."""
    current_model = llm_service.get_current_model()
    status = llm_service.get_model_status(current_model)
    return {"model": current_model, "status": status}

@app.post("/api/llm-unload")
def unload_llm_model():
    """Unload the current LLM."""
    current_model = llm_service.get_current_model()
    success = llm_service.unload_model(current_model)
    return {"status": "success" if success else "failed", "model": current_model}

@app.get("/api/status-stream")
async def get_status_stream():
    """Stream application status (LLMs, TTS models) via Server-Sent Events."""
    async def event_generator():
        while True:
            try:
                def _get_status():
                    # LLM Status
                    llm_available = llm_service.check_llm_available()
                    current_llm = llm_service.get_current_model()
                    llm_status = llm_service.get_model_status(current_llm) if llm_available else "not-loaded"
                    llm_models = llm_service.get_available_models() if llm_available else []

                    # Qwen3 Status
                    qwen3_info = qwen3_manager.get_model_info()

                    return {
                        "llm_available": llm_available,
                        "current_llm": current_llm,
                        "llm_status": llm_status,
                        "llm_models": llm_models,
                        "qwen3_info": qwen3_info
                    }

                status_data = await asyncio.to_thread(_get_status)

                yield {
                    "event": "status",
                    "data": json.dumps(status_data)
                }
            except asyncio.CancelledError:
                break
            except Exception as e:
                logging.error(f"Error in status stream: {e}")
                # Don't break the stream, just log and loop
            
            # Broadcast every 2 seconds
            await asyncio.sleep(2.0)

    return EventSourceResponse(event_generator())

@app.get("/api/history")
def get_history():
    return history_manager.get_history()

@app.delete("/api/history/{entry_id}")
def delete_history(entry_id: str):
    history_manager.delete_entry(entry_id)
    return {"status": "success"}

class RenameRequest(BaseModel):
    name: str

@app.post("/api/history/{entry_id}/rename")
def rename_history_entry(entry_id: str, req: RenameRequest):
    """Rename a history entry."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    
    result = history_manager.rename_entry(entry_id, req.name)
    if result is None:
        raise HTTPException(status_code=404, detail="Entry not found or rename failed")
    
    return result

@app.post("/api/history/{entry_id}/auto-rename")
def auto_rename_history_entry(entry_id: str):
    """Auto-rename a history entry using LLM to generate a descriptive filename."""
    # Find the entry to get its text
    history = history_manager.get_history()
    entry = next((e for e in history if e["id"] == entry_id), None)
    
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    if not entry.get("text"):
        raise HTTPException(status_code=400, detail="Entry has no text content")
    
    # Check if LLM is available
    if not llm_service.check_llm_available():
        raise HTTPException(status_code=503, detail="LLM service not available")
    
    # Generate filename using LLM
    generated_name = llm_service.generate_filename(entry["text"])
    if not generated_name:
        raise HTTPException(status_code=500, detail="Failed to generate filename")
    
    # Rename the entry
    result = history_manager.rename_entry(entry_id, generated_name)
    if result is None:
        raise HTTPException(status_code=500, detail="Rename operation failed")
    
    return result

@app.get("/api/alignment/{entry_id}")
async def get_alignment(entry_id: str):
    """
    Get word-level alignment data for a history entry.
    Generates alignment on first request (on-demand), caches to JSON file.
    """
    # Find the entry
    history = history_manager.get_history()
    entry = next((e for e in history if e["id"] == entry_id), None)
    
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    # Get paths
    audio_path = history_manager.get_output_path(entry["filename"])
    alignment_path = alignment_service.get_alignment_path(audio_path)
    
    # Check if alignment already exists (cached)
    existing = alignment_service.load_alignment(alignment_path)
    if existing:
        return {
            "words": [
                {
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    "charStart": w.char_start,
                    "charEnd": w.char_end
                }
                for w in existing
            ],
            "cached": True
        }
    
    # Generate alignment on-demand
    try:
        # Get language code from voice
        language = alignment_service.get_language_code(entry.get("voice", "af_heart"))
        
        # Run alignment in thread pool to avoid blocking
        alignment = await asyncio.to_thread(
            alignment_service.align_audio_to_text,
            audio_path,
            entry["text"],
            language
        )
        
        # Cache the alignment
        alignment_service.save_alignment(alignment, alignment_path)
        
        return {
            "words": [
                {
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    "charStart": w.char_start,
                    "charEnd": w.char_end
                }
                for w in alignment
            ],
            "cached": False
        }
        
    except Exception as e:
        logging.error(f"Alignment failed for {entry_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Alignment failed: {str(e)}")

@app.post("/api/generate")
async def generate_audio(req: GenerateRequest):
    """Generate audio with progress streaming via SSE."""
    
    async def event_generator():
        try:
            chunks = split_into_chunks(req.text, max_chars=req.chunk_size)
            total_chunks = len(chunks)
            all_samples = []
            sample_rate = None
            
            # If using a voice profile, set up cloning
            voice_clone_prompt = None
            voice_name = req.voice  # Default to speaker name
            if req.voice_profile_id:
                yield {
                    "event": "progress",
                    "data": json.dumps({"progress": 0, "chunk": 0, "total": total_chunks, "message": "Loading voice profile..."})
                }
                
                profile = voice_profile_manager.get_profile(req.voice_profile_id)
                if profile is None:
                    raise ValueError(f"Voice profile not found: {req.voice_profile_id}")
                
                # Use profile name as voice identifier for history
                voice_name = profile.name
                
                ref_audio = voice_profile_manager.get_reference_audio(req.voice_profile_id)
                if ref_audio is None:
                    raise ValueError(f"Reference audio not found for profile: {req.voice_profile_id}")
                
                # Load Base model for cloning
                await asyncio.to_thread(qwen3_manager.load_model, "base-1.7B")
                
                # Create voice clone prompt (reusable for all chunks)
                voice_clone_prompt = await asyncio.to_thread(
                    qwen3_manager.create_voice_clone_prompt,
                    ref_audio[0],
                    ref_audio[1],
                    profile.reference_text,
                )
            
            for i, chunk in enumerate(chunks):
                progress = int((i / total_chunks) * 100)
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "progress": progress,
                        "chunk": i + 1,
                        "total": total_chunks,
                        "chunk_preview": chunk[:50]
                    })
                }
                
                # Use the appropriate TTS engine (run in thread to avoid blocking)
                if voice_clone_prompt is not None:
                    # Voice cloning mode - uses Base model
                    samples, sr = await asyncio.to_thread(
                        qwen3_manager.generate_voice_clone,
                        chunk,
                        voice_clone_prompt,
                        req.lang or "auto",
                    )
                elif req.engine == "qwen3":
                    samples, sr = await asyncio.to_thread(
                        qwen3_manager.generate_audio,
                        chunk,
                        req.voice,
                        req.lang or "auto",
                        req.instruct,
                    )
                else:
                    samples, sr = await asyncio.to_thread(
                        model_manager.generate_audio,
                        chunk,
                        req.voice,
                        req.speed,
                        req.lang,
                    )
                all_samples.append(samples)
                sample_rate = sr
                
                await asyncio.sleep(0.01)
            
            # Crossfade and normalize chunks for smoother transitions
            if len(all_samples) > 1:
                final_samples = crossfade_chunks(all_samples, sample_rate, crossfade_ms=200)
            else:
                final_samples = all_samples[0] if all_samples else np.array([], dtype=np.float32)
            duration = len(final_samples) / sample_rate
            
            # Try to generate a descriptive filename using LLM
            generated_name = llm_service.generate_filename(req.text)
            if generated_name:
                # Add short UUID suffix to prevent overwrites
                short_id = str(uuid.uuid4())[:8]
                filename = f"{generated_name}-{short_id}.wav"
            else:
                filename = f"{uuid.uuid4()}.wav"
            
            filepath = history_manager.get_output_path_for_new_file(filename)
            sf.write(filepath, final_samples, sample_rate, format='WAV')
            
            # Build model identifier for history
            if req.engine == "qwen3":
                model_name = "Qwen3-TTS"
            else:
                model_name = "Kokoro"
            
            entry = history_manager.add_entry(req.text, voice_name, req.speed, filename, duration, model_name, req.voice_profile_id)
            
            yield {
                "event": "complete",
                "data": json.dumps(entry)
            }
            
        except Exception as e:
            logging.error(f"Generation failed: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }
    
    return EventSourceResponse(event_generator())

@app.post("/api/cleanup-text")
async def cleanup_text(req: CleanupRequest):
    """Clean text with progress streaming via SSE."""
    
    async def event_generator():
        try:
            if not llm_service.check_llm_available():
                yield {
                    "event": "error",
                    "data": json.dumps({"error": "LM Studio is not running. Please start it and try again."})
                }
                return
            
            chunks = llm_service.split_into_chunks(req.text)
            total_chunks = len(chunks)
            cleaned_chunks = []
            
            for i, chunk in enumerate(chunks):
                progress = int((i / total_chunks) * 100)
                yield {
                    "event": "progress",
                    "data": json.dumps({"progress": progress, "chunk": i + 1, "total": total_chunks})
                }
                
                # Run cleanup in thread pool to avoid blocking
                cleaned = await asyncio.to_thread(llm_service.cleanup_text_chunk, chunk)
                cleaned_chunks.append(cleaned)
                
                await asyncio.sleep(0.01)
            
            # Join cleaned chunks
            full_cleaned_text = "\n\n".join(cleaned_chunks)
            
            yield {
                "event": "complete",
                "data": json.dumps({"text": full_cleaned_text})
            }
            
        except Exception as e:
            logging.error(f"Text cleanup failed: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }
    
    return EventSourceResponse(event_generator())

# Project endpoints

class CreateProjectRequest(BaseModel):
    name: str

class RenameProjectRequest(BaseModel):
    name: str

class UpdateProjectColorRequest(BaseModel):
    color: str | None = None

class AddGenerationRequest(BaseModel):
    generation_id: str


def _resolve_project(project: dict) -> dict:
    """Attach resolved generation objects from history to a project."""
    history = history_manager.get_history()
    history_map = {item["id"]: item for item in history}
    resolved = [history_map[gid] for gid in project["generation_ids"] if gid in history_map]
    return {**project, "generations": resolved}


@app.get("/api/projects")
def list_projects():
    """List all projects with generation counts."""
    projects = project_manager.list_projects()
    return [_resolve_project(p) for p in projects]


@app.post("/api/projects")
def create_project(req: CreateProjectRequest):
    """Create a new project."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    return _resolve_project(project_manager.create_project(req.name))


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    """Get a single project with resolved generations."""
    project = project_manager.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _resolve_project(project)


@app.patch("/api/projects/{project_id}")
def rename_project(project_id: str, req: RenameProjectRequest):
    """Rename a project."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    result = project_manager.rename_project(project_id, req.name)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _resolve_project(result)


@app.patch("/api/projects/{project_id}/color")
def update_project_color(project_id: str, req: UpdateProjectColorRequest):
    """Update a project's color."""
    result = project_manager.update_project_color(project_id, req.color)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _resolve_project(result)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    """Delete a project (does not delete generations)."""
    if not project_manager.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}


class ReorderProjectsRequest(BaseModel):
    ordered_ids: list[str]


@app.put("/api/projects/reorder")
def reorder_projects(req: ReorderProjectsRequest):
    """Reorder projects to match the given ID order."""
    result = project_manager.reorder_projects(req.ordered_ids)
    return [_resolve_project(p) for p in result]


@app.post("/api/projects/{project_id}/generations")
def add_generation_to_project(project_id: str, req: AddGenerationRequest):
    """Add a generation to a project."""
    result = project_manager.add_generation(project_id, req.generation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _resolve_project(result)


@app.delete("/api/projects/{project_id}/generations/{generation_id}")
def remove_generation_from_project(project_id: str, generation_id: str):
    """Remove a generation from a project."""
    result = project_manager.remove_generation(project_id, generation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _resolve_project(result)


class ReorderGenerationsRequest(BaseModel):
    ordered_ids: list[str]


@app.put("/api/projects/{project_id}/generations/reorder")
def reorder_project_generations(project_id: str, req: ReorderGenerationsRequest):
    """Reorder generations within a project."""
    result = project_manager.reorder_generations(project_id, req.ordered_ids)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _resolve_project(result)


@app.post("/api/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    """Extract text from uploaded PDF."""
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Invalid file type. Only PDF allowed.")
    
    try:
        content = await file.read()
        text = extract_text_from_pdf(content)
        return {"text": text}
    except Exception as e:
        logging.error(f"PDF Parsing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class ShowInExplorerRequest(BaseModel):
    filename: str

@app.post("/api/show-in-explorer")
async def show_in_explorer(req: ShowInExplorerRequest):
    """Open Windows Explorer and highlight the specified file."""
    import subprocess
    import os
    
    filepath = history_manager.get_output_path(req.filename)
    abs_path = os.path.abspath(filepath)
    
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        # Windows: /select highlights the file in Explorer
        subprocess.Popen(f'explorer /select,"{abs_path}"')
        return {"status": "success"}
    except Exception as e:
        logging.error(f"Failed to open explorer: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Note: reload=False to prevent restarts during Qwen3-TTS model loading
    # Restart manually after code changes
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
