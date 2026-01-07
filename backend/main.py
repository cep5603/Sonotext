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
from pdf_processor import extract_text_from_pdf
from history_manager import history_manager
import llm_service

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
    voice: str = "af_sarah"
    speed: float = 1.0

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
def get_voices():
    """Return available voice IDs."""
    if not model_manager.voices:
        return []
    return list(model_manager.voices.keys())

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
    """Get list of available LLM models."""
    models = llm_service.get_available_models()
    return {"models": models, "currentModel": llm_service.get_current_model()}

class SetModelRequest(BaseModel):
    model: str

@app.post("/api/llm-model")
def set_llm_model(req: SetModelRequest):
    """Set the LLM model to use."""
    llm_service.set_current_model(req.model)
    return {"status": "success", "model": req.model}

@app.get("/api/history")
def get_history():
    history_manager.update_missing_durations()
    return history_manager.get_history()

@app.delete("/api/history/{entry_id}")
def delete_history(entry_id: str):
    history_manager.delete_entry(entry_id)
    return {"status": "success"}

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
                
                samples, sr = model_manager.generate_audio(chunk, req.voice, req.speed)
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
            
            entry = history_manager.add_entry(req.text, req.voice, req.speed, filename, duration)
            
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
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
