import os
from pathlib import Path
from logging.handlers import RotatingFileHandler

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
LOG_PATH = LOG_DIR / "sonotext.log"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

os.environ["HF_HOME"] = str(BASE_DIR / "hub")

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import io
import re
import json
import base64
import soundfile as sf
import numpy as np
import logging
import uuid
import asyncio
from language_utils import (
    KOKORO_LANG_LABELS,
    get_alignment_language_code_from_voice,
    map_language_to_whisper_language,
    normalize_language_code,
)
from model_manager import model_manager
from qwen_tts_manager import qwen3_manager
from zonos_manager import zonos2_manager
from voice_profiles import voice_profile_manager, DEFAULT_REFERENCE_TEXT
from pdf_processor import extract_text_from_pdf
from history_manager import history_manager
from project_manager import project_manager
from bookmark_manager import bookmark_manager
import llm_service
import alignment_service

def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    if not any(isinstance(handler, RotatingFileHandler) and getattr(handler, "baseFilename", None) == str(LOG_PATH) for handler in root_logger.handlers):
        file_handler = RotatingFileHandler(LOG_PATH, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    if not any(isinstance(handler, logging.StreamHandler) for handler in root_logger.handlers):
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        root_logger.addHandler(stream_handler)

setup_logging()

app = FastAPI(title="Sonotext Local API")

WAVEFORM_PEAK_COUNT = 1200
LOG_STREAM_POLL_INTERVAL = 1.0
LOG_STREAM_MAX_INITIAL_BYTES = 200_000

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount outputs directory
app.mount("/outputs", StaticFiles(directory=str(BASE_DIR / "outputs")), name="outputs")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/logs")
async def get_logs():
    async def event_generator():
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        LOG_PATH.touch(exist_ok=True)
        position = max(0, LOG_PATH.stat().st_size - LOG_STREAM_MAX_INITIAL_BYTES)
        while True:
            try:
                with LOG_PATH.open("r", encoding="utf-8", errors="replace") as log_file:
                    log_file.seek(position)
                    chunk = log_file.read()
                    position = log_file.tell()
                if chunk:
                    yield {
                        "event": "logs",
                        "data": json.dumps({"chunk": chunk}),
                    }
                await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)
            except asyncio.CancelledError:
                break
            except Exception as e:
                yield {
                    "event": "logs",
                    "data": json.dumps({"chunk": f"\n[log stream error] {e}\n"}),
                }
                await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)

    return EventSourceResponse(event_generator())

class GenerateRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0
    lang: str | None = None  # None means auto-detect from voice
    engine: str = "kokoro"  # "kokoro", "qwen3", or "zonos2"
    instruct: str | None = None  # Qwen3-TTS emotion/style instruction
    voice_profile_id: str | None = None  # Custom voice profile for cloning
    chunk_size: int = 500  # Max characters per chunk for TTS
    seed: int | None = None  # ZONOS2 sampling seed (optional, for reproducibility)

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

def build_waveform_payload(samples: np.ndarray, sample_rate: int, duration: float | None = None) -> dict:
    audio = np.asarray(samples, dtype=np.float32)
    if audio.ndim == 2:
        if audio.shape[1] == 1:
            audio = audio[:, 0]
        else:
            audio = audio.mean(axis=1)
    elif audio.ndim > 2:
        audio = audio.reshape(audio.shape[0], -1).mean(axis=1)

    audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)
    if audio.size == 0:
        return {
            "peaks": [0.0],
            "duration": float(duration or 0.0),
        }

    bucket_count = max(1, min(WAVEFORM_PEAK_COUNT, int(audio.shape[0])))
    bucket_size = max(1, int(np.ceil(audio.shape[0] / bucket_count)))
    peaks = [
        float(np.max(np.abs(audio[start:start + bucket_size])))
        for start in range(0, audio.shape[0], bucket_size)
    ]
    peak_max = max(peaks, default=0.0)
    if peak_max > 0:
        peaks = [round(peak / peak_max, 6) for peak in peaks]

    return {
        "peaks": peaks,
        "duration": float(duration if duration is not None else audio.shape[0] / sample_rate),
    }

def load_waveform_payload(waveform_path: str) -> dict | None:
    try:
        with open(waveform_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        peaks = data.get("peaks")
        duration = data.get("duration")
        if not isinstance(peaks, list) or duration is None:
            return None
        return {
            "peaks": [float(peak) for peak in peaks],
            "duration": float(duration),
        }
    except Exception:
        return None

def save_waveform_payload(waveform_path: str, payload: dict):
    with open(waveform_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)

def generate_waveform_payload(audio_path: str) -> dict:
    samples, sample_rate = sf.read(audio_path, dtype="float32")
    return build_waveform_payload(samples, sample_rate)

def sonotext_loop_factory():
    if os.name == "nt":
        return asyncio.SelectorEventLoop()
    return asyncio.new_event_loop()

@app.get("/api/voices")
def get_voices(engine: str = "kokoro"):
    """Return available voice IDs for the specified engine."""
    if engine == "qwen3":
        return {"voices": qwen3_manager.get_voices()}
    if engine == "zonos2":
        return {"voices": zonos2_manager.get_voices()}
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
            {
                "id": "zonos2",
                "name": "ZONOS2",
                "description": "High-fidelity voice cloning TTS (runs in WSL2)",
                "loaded": zonos2_manager.is_server_running(),
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


# ZONOS2 (runs as a server inside WSL2)

@app.get("/api/zonos2/status")
def get_zonos2_status():
    """Get ZONOS2 server status (running, launching, WSL availability, config)."""
    return zonos2_manager.status()


@app.get("/api/zonos2/config")
def get_zonos2_config():
    """Get the ZONOS2 launch configuration."""
    return zonos2_manager.get_config()


class Zonos2ConfigRequest(BaseModel):
    distro: str | None = None
    repo_dir: str | None = None
    model_path: str | None = None
    host: str | None = None
    bind_host: str | None = None
    port: int | None = None
    dtype: str | None = None
    default_voices_dir: str | None = None
    extra_args: str | None = None
    auto_launch: bool | None = None


@app.put("/api/zonos2/config")
def update_zonos2_config(req: Zonos2ConfigRequest):
    """Update the ZONOS2 launch configuration."""
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    return zonos2_manager.update_config(patch)


@app.post("/api/zonos2/start")
async def start_zonos2_server():
    """Launch the ZONOS2 server inside WSL2 (non-blocking)."""
    try:
        return await asyncio.to_thread(zonos2_manager.start_server)
    except Exception as e:
        logging.error(f"Failed to start ZONOS2 server: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zonos2/stop")
async def stop_zonos2_server():
    """Stop the ZONOS2 server running inside WSL2."""
    return await asyncio.to_thread(zonos2_manager.stop_server)


def _build_model_registry() -> list[dict]:
    """Aggregate the state of every model subsystem into a flat list."""
    models = []

    # Kokoro pipelines (one per loaded language)
    loaded_pipelines = model_manager.get_loaded_pipelines()
    for code, label in KOKORO_LANG_LABELS.items():
        models.append({
            "id": f"kokoro:{code}",
            "name": f"Kokoro — {label}",
            "category": "tts",
            "loaded": code in loaded_pipelines,
            "size_label": "82M params",
            "can_unload": code in loaded_pipelines,
            "can_load": code not in loaded_pipelines,
        })

    # Qwen3-TTS
    qwen3_info = qwen3_manager.get_model_info()
    qwen3_loaded = qwen3_info.get("loaded", False)
    qwen3_loading = qwen3_info.get("is_loading", False)
    qwen3_model_key = qwen3_info.get("model_key")
    from qwen_tts_manager import QWEN3_MODELS
    for key, hf_id in QWEN3_MODELS.items():
        is_this_loaded = qwen3_loaded and qwen3_model_key == key
        short_name = hf_id.split("/")[-1]
        detail = None
        if is_this_loaded and qwen3_info.get("flash_attention") is not None:
            detail = f"FlashAttention: {'✓' if qwen3_info['flash_attention'] else '✗'}"
        models.append({
            "id": f"qwen3:{key}",
            "name": short_name,
            "category": "tts",
            "loaded": is_this_loaded,
            "loading": qwen3_loading and (qwen3_model_key == key or qwen3_model_key is None),
            "size_label": "1.7B params",
            "detail": detail,
            "can_unload": is_this_loaded,
            "can_load": not is_this_loaded,
        })

    # ZONOS2 (server in WSL2)
    zonos2_status = zonos2_manager.status()
    zonos2_running = zonos2_status.get("running", False)
    zonos2_launching = zonos2_status.get("launching", False)
    if not zonos2_status.get("wsl_available", False):
        zonos2_detail = "WSL2 not available"
    elif zonos2_status.get("last_error") and not zonos2_running:
        zonos2_detail = "Startup failed — see logs"
    else:
        zonos2_detail = "WSL2 server"
    models.append({
        "id": "zonos2",
        "name": "ZONOS2",
        "category": "tts",
        "loaded": zonos2_running,
        "loading": zonos2_launching,
        "size_label": "MoE TTS",
        "detail": zonos2_detail,
        "can_unload": zonos2_running,
        "can_load": not zonos2_running and not zonos2_launching,
    })

    # CTC Forced Aligner
    alignment_loaded = alignment_service.is_loaded()
    models.append({
        "id": "alignment",
        "name": "CTC Forced Aligner",
        "category": "alignment",
        "loaded": alignment_loaded,
        "size_label": "300M params",
        "can_unload": alignment_loaded,
        "can_load": not alignment_loaded,
    })

    # LM Studio LLMs
    lm_available = llm_service.check_llm_available()
    if lm_available:
        lm_models = llm_service.get_available_models()
        for m in lm_models:
            mid = m["id"]
            state = m.get("state", "not-loaded")
            size_bytes = m.get("size_bytes", 0)
            if size_bytes > 0:
                size_label = f"{size_bytes / (1024**3):.2f} GB"
            else:
                size_label = m.get("quantization", "")
            models.append({
                "id": f"lmstudio:{mid}",
                "name": mid.split("/")[-1] if "/" in mid else mid,
                "category": "llm",
                "loaded": state == "loaded",
                "loading": state == "loading",
                "size_label": size_label,
                "can_unload": state == "loaded",
                "can_load": state != "loaded",
            })
    else:
        models.append({
            "id": "lmstudio:offline",
            "name": "LM Studio",
            "category": "llm",
            "loaded": False,
            "size_label": "Offline",
            "detail": "LM Studio is not running",
            "can_unload": False,
            "can_load": False,
            "offline": True,
        })

    return models


@app.get("/api/models")
def get_all_models():
    """Return a unified list of all models and their states."""
    return {"models": _build_model_registry()}


@app.post("/api/models/{model_id:path}/load")
def load_model_by_id(model_id: str):
    """Load a model by its registry ID."""
    try:
        if model_id.startswith("kokoro:"):
            lang_code = model_id.split(":", 1)[1]
            # Force-create the pipeline by generating with it
            model_manager._get_pipeline(lang_code)
            return {"status": "success"}

        if model_id.startswith("qwen3:"):
            model_key = model_id.split(":", 1)[1]
            qwen3_manager.load_model(model_key)
            return {"status": "success"}

        if model_id == "zonos2":
            zonos2_manager.start_server()
            return {"status": "success"}

        if model_id == "alignment":
            alignment_service.load_model()
            return {"status": "success"}

        if model_id.startswith("lmstudio:"):
            lm_id = model_id.split(":", 1)[1]
            import subprocess
            result = subprocess.run(
                ["lms", "load", lm_id],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                return {"status": "success"}
            raise RuntimeError(result.stderr or "lms load failed")

        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to load model {model_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/models/{model_id:path}/unload")
def unload_model_by_id(model_id: str):
    """Unload a model by its registry ID."""
    try:
        if model_id.startswith("kokoro:"):
            lang_code = model_id.split(":", 1)[1]
            if not model_manager.unload_pipeline(lang_code):
                raise HTTPException(status_code=404, detail=f"Pipeline {lang_code} not loaded")
            return {"status": "success"}

        if model_id.startswith("qwen3:"):
            qwen3_manager.unload_model()
            return {"status": "success"}

        if model_id == "zonos2":
            zonos2_manager.stop_server()
            return {"status": "success"}

        if model_id == "alignment":
            alignment_service.unload_model()
            return {"status": "success"}

        if model_id.startswith("lmstudio:"):
            lm_id = model_id.split(":", 1)[1]
            success = llm_service.unload_model(lm_id)
            return {"status": "success" if success else "failed"}

        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to unload model {model_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
            
            whisper_lang = map_language_to_whisper_language(language)
            
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
    """Stream application status (LLMs, TTS models, model registry) via Server-Sent Events."""
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

                    # ZONOS2 (WSL2 server) status
                    zonos2_status = zonos2_manager.status()

                    # Full model registry
                    model_registry = _build_model_registry()

                    return {
                        "llm_available": llm_available,
                        "current_llm": current_llm,
                        "llm_status": llm_status,
                        "llm_models": llm_models,
                        "qwen3_info": qwen3_info,
                        "zonos2_status": zonos2_status,
                        "model_registry": model_registry,
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
    bookmark_manager.delete_bookmarks(entry_id)
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
        if entry.get("engine") == "kokoro":
            language = get_alignment_language_code_from_voice(entry.get("voice", "af_heart"))
        else:
            language = normalize_language_code(entry.get("lang"))
        
        # Run alignment in thread pool to avoid blocking
        alignment = await asyncio.to_thread(
            alignment_service.align_audio_to_text,
            audio_path,
            entry["text"],
            language,
            16,
            entry.get("chunk_size"),
            entry.get("duration"),
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

@app.get("/api/waveform/{entry_id}")
async def get_waveform(entry_id: str):
    history = history_manager.get_history()
    entry = next((e for e in history if e["id"] == entry_id), None)

    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    audio_path = history_manager.get_output_path(entry["filename"])
    waveform_path = history_manager.get_waveform_path(audio_path)

    cached_waveform = await asyncio.to_thread(load_waveform_payload, waveform_path)
    if cached_waveform:
        return {
            **cached_waveform,
            "cached": True,
        }

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        waveform_payload = await asyncio.to_thread(generate_waveform_payload, audio_path)
        await asyncio.to_thread(save_waveform_payload, waveform_path, waveform_payload)
        return {
            **waveform_payload,
            "cached": False,
        }
    except Exception as e:
        logging.error(f"Waveform generation failed for {entry_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Waveform generation failed: {str(e)}")

@app.post("/api/generate")
async def generate_audio(req: GenerateRequest):
    """Generate audio with progress streaming via SSE."""
    
    async def event_generator():
        try:
            chunks = split_into_chunks(req.text, max_chars=req.chunk_size)
            total_chunks = len(chunks)
            all_samples = []
            sample_rate = None
            
            # If using a voice profile, set up cloning (engine-specific)
            voice_clone_prompt = None       # Qwen3-TTS reusable clone prompt
            zonos_speaker_b64 = None        # ZONOS2 reference clip (base64 WAV)
            zonos_speaker_name = None
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
                
                if req.engine == "zonos2":
                    # ZONOS2 clones zero-shot from a base64-encoded reference clip.
                    buffer = io.BytesIO()
                    sf.write(buffer, ref_audio[0], ref_audio[1], format="WAV")
                    zonos_speaker_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
                    zonos_speaker_name = profile.name
                else:
                    # Qwen3-TTS: load Base model and build a reusable clone prompt.
                    await asyncio.to_thread(qwen3_manager.load_model, "base-1.7B")
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
                if req.engine == "zonos2":
                    # ZONOS2 runs in WSL2; speaker clip (if any) drives voice cloning.
                    samples, sr = await asyncio.to_thread(
                        zonos2_manager.generate,
                        chunk,
                        req.lang or "en_us",
                        zonos_speaker_b64,
                        zonos_speaker_name,
                        req.seed,
                    )
                elif voice_clone_prompt is not None:
                    # Voice cloning mode - uses Base model
                    samples, sr = await asyncio.to_thread(
                        qwen3_manager.generate_voice_clone,
                        chunk,
                        voice_clone_prompt,
                        req.lang or "auto",
                    )
                elif req.engine == "qwen3":
                    # Auto-load CustomVoice model if not already loaded
                    if not qwen3_manager.is_loaded or qwen3_manager.model_type != "custom":
                        await asyncio.to_thread(qwen3_manager.load_model, "custom-1.7B")
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
            try:
                waveform_payload = build_waveform_payload(final_samples, sample_rate, duration)
                save_waveform_payload(history_manager.get_waveform_path(filepath), waveform_payload)
            except Exception as e:
                logging.warning(f"Failed to cache waveform for {filepath}: {e}")
            
            # Build model identifier for history
            if req.engine == "qwen3":
                model_name = "Qwen3-TTS"
            elif req.engine == "zonos2":
                model_name = "ZONOS2"
            else:
                model_name = "Kokoro"
            
            entry = history_manager.add_entry(
                req.text,
                voice_name,
                req.speed,
                filename,
                duration,
                model_name,
                req.voice_profile_id,
                req.engine,
                req.lang,
                req.instruct if req.engine == "qwen3" else None,
                req.chunk_size,
            )
            
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


# Bookmark endpoints

class SaveBookmarksRequest(BaseModel):
    bookmarks: list[dict]


@app.get("/api/bookmarks/{generation_id}")
def get_bookmarks(generation_id: str):
    """Get bookmarks for a generation."""
    return {"bookmarks": bookmark_manager.get_bookmarks(generation_id)}


@app.put("/api/bookmarks/{generation_id}")
def save_bookmarks(generation_id: str, req: SaveBookmarksRequest):
    """Save bookmarks for a generation (full replacement)."""
    bookmark_manager.save_bookmarks(generation_id, req.bookmarks)
    return {"status": "success"}


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
        subprocess.run(["explorer", "/select,", abs_path])
    return {"status": "success"}

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    if os.name == "nt" and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    # Note: reload=False to prevent restarts during Qwen3-TTS model loading
    # Restart manually after code changes
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, loop="main:sonotext_loop_factory")
