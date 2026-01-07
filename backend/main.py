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

def split_into_chunks(text: str, max_chars: int = 500) -> list[str]:
    """Split text into chunks at sentence boundaries."""
    # Split by sentence-ending punctuation
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
    
    # If no chunks created (no sentence boundaries), just return original
    return chunks if chunks else [text]

@app.get("/api/voices")
def get_voices():
    """Return available voice IDs."""
    if not model_manager.voices:
        return []
    return list(model_manager.voices.keys())

@app.get("/api/history")
def get_history():
    # Auto-fix missing durations for older entries
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
                # Send progress update
                progress = int((i / total_chunks) * 100)
                yield {
                    "event": "progress",
                    "data": json.dumps({"progress": progress, "chunk": i + 1, "total": total_chunks})
                }
                
                # Generate audio for this chunk
                samples, sr = model_manager.generate_audio(chunk, req.voice, req.speed)
                all_samples.append(samples)
                sample_rate = sr
                
                # Small yield to allow progress update to be sent
                await asyncio.sleep(0.01)
            
            # Concatenate all audio
            final_samples = np.concatenate(all_samples)
            duration = len(final_samples) / sample_rate
            
            # Save to disk
            filename = f"{uuid.uuid4()}.wav"
            filepath = history_manager.get_output_path(filename)
            sf.write(filepath, final_samples, sample_rate, format='WAV')
            
            # Add to history
            entry = history_manager.add_entry(req.text, req.voice, req.speed, filename, duration)
            
            # Send completion with entry data
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
