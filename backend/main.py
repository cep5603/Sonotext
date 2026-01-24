import os
os.environ["HF_HOME"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hub")

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
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
from pdf_processor import extract_text_from_pdf
from history_manager import history_manager
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
                "description": "Expressive, multilingual TTS (0.6B/1.7B params)",
                "loaded": qwen3_manager.is_loaded,
            },
        ]
    }


@app.get("/api/qwen3/info")
def get_qwen3_info():
    """Get Qwen3-TTS model info."""
    return qwen3_manager.get_model_info()


class LoadQwen3Request(BaseModel):
    model_size: str = "1.7B"  # "0.6B" or "1.7B"


@app.post("/api/qwen3/load")
def load_qwen3_model(req: LoadQwen3Request):
    """Load a Qwen3-TTS model."""
    try:
        qwen3_manager.load_model(req.model_size)
        return qwen3_manager.get_model_info()
    except Exception as e:
        logging.error(f"Failed to load Qwen3-TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/qwen3/unload")
def unload_qwen3_model():
    """Unload the Qwen3-TTS model to free VRAM."""
    qwen3_manager.unload_model()
    return {"status": "success"}

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

@app.get("/api/history")
def get_history():
    history_manager.update_missing_durations()
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
            chunks = split_into_chunks(req.text)
            total_chunks = len(chunks)
            all_samples = []
            sample_rate = None
            
            for i, chunk in enumerate(chunks):
                progress = int((i / total_chunks) * 100)
                yield {
                    "event": "progress",
                    "data": json.dumps({"progress": progress, "chunk": i + 1, "total": total_chunks})
                }
                
                # Use the appropriate TTS engine (run in thread to avoid blocking)
                if req.engine == "qwen3":
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
            
            final_samples = np.concatenate(all_samples)
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
                model_name = f"qwen3-{qwen3_manager.model_size or 'unknown'}"
            else:
                model_name = "kokoro"
            
            entry = history_manager.add_entry(req.text, req.voice, req.speed, filename, duration, model_name)
            
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
