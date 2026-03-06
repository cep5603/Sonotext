import httpx
import re
import json
import logging
from typing import Optional

logger = logging.getLogger("LLMService")

# LM Studio configuration
LM_STUDIO_URL = "http://127.0.0.1:1234"
TIMEOUT = 60.0  # seconds

# Current selected model (can be changed via API)
_current_model: str = "qwen3.5-2b/Qwen3.5-2B-Q8_0"

# Chunking configuration for text cleanup
CHUNK_SIZE = 12000  # ~4000 tokens (assuming ~3 chars per token)
CHUNK_OVERLAP = 500  # characters


def get_current_model() -> str:
    """Get the currently selected model."""
    return _current_model


def set_current_model(model: str) -> None:
    """Set the model to use for LLM operations."""
    global _current_model
    _current_model = model
    logger.info(f"LLM set to: {model}")


def slugify(text: str, max_length: int = 80) -> str:
    """Convert text to a valid filename slug."""
    text = text.lower()
    text = re.sub(r'[\s_]+', '-', text) # Replace spaces and underscores with hyphens
    text = re.sub(r'[^a-z0-9\-]', '', text) # Remove any non-alphanumeric characters except hyphens
    text = re.sub(r'-+', '-', text) # Remove multiple consecutive hyphens
    text = text.strip('-') # Remove leading/trailing hyphens
    # Truncate to max length
    if len(text) > max_length:
        text = text[:max_length].rsplit('-', 1)[0]
    return text or "untitled"


def check_llm_available() -> bool:
    """Check if LM Studio server is running and accessible."""
    try:
        with httpx.Client(timeout=1.0) as client:
            response = client.get(f"{LM_STUDIO_URL}/api/v0/models")
            return response.status_code == 200
    except Exception:
        return False


def get_available_models() -> list[dict]:
    """Get list of available LLMs from LM Studio."""
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{LM_STUDIO_URL}/api/v0/models")
            if response.status_code == 200:
                data = response.json()
                models = []
                for model in data.get("data", []):
                    if model.get("type") in ("llm", "vlm"):
                        models.append({
                            "id": model.get("id"),
                            "publisher": model.get("publisher"),
                            "quantization": model.get("quantization"),
                            "state": model.get("state"),
                            "max_context_length": model.get("max_context_length"),
                            "size_bytes": model.get("size_bytes", 0)
                        })
                return models
            return []
    except Exception as e:
        logger.error(f"Failed to get models: {e}")
        return []


def get_model_status(model_id: str) -> str:
    """Get the loading status of a specific model. Returns 'loaded', 'loading', or 'not-loaded'."""
    try:
        with httpx.Client(timeout=1.0) as client:
            # URL encode the model_id for path
            encoded_id = model_id.replace("/", "%2F")
            response = client.get(f"{LM_STUDIO_URL}/api/v0/models/{encoded_id}")
            if response.status_code == 200:
                data = response.json()
                return data.get("state", "not-loaded")
            return "not-loaded"
    except Exception as e:
        logger.error(f"Failed to get model status: {e}")
        return "not-loaded"


def unload_model(model_id: str) -> bool:
    """Unload a model using the LM Studio CLI."""
    import subprocess
    try:
        result = subprocess.run(
            ["lms", "unload", model_id],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            logger.info(f"Unloaded model: {model_id}")
            return True
        else:
            logger.error(f"Failed to unload model: {result.stderr}")
            return False
    except Exception as e:
        logger.error(f"Failed to unload model: {e}")
        return False


def generate_filename(text: str) -> Optional[str]:
    """
    Generate a concise, descriptive filename from text content.
    Returns None if LLM is unavailable or fails.
    """
    if not check_llm_available():
        logger.info("LM Studio not available, skipping filename generation")
        return None
    
    # Use first 500 chars for context
    text_sample = text[:500].strip()
    if not text_sample:
        return None
    
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{LM_STUDIO_URL}/v1/chat/completions",
                json={
                    "model": _current_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a filename generator. Given text, create a short descriptive filename (3-6 words). Output ONLY the filename, nothing else. Use underscores between words. No file extension."
                        },
                        {
                            "role": "user",
                            "content": f"Generate a filename for this text:\n\n{text_sample}"
                        }
                    ],
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "filename_response",
                            "strict": True,
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "filename": {"type": "string"}
                                },
                                "required": ["filename"]
                            }
                        }
                    },
                    "temperature": 0.3,
                    "max_tokens": 50
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                raw_filename = parsed.get("filename", "")
                return slugify(raw_filename)
            else:
                logger.warning(f"LLM request failed: {response.status_code}")
                return None
                
    except Exception as e:
        logger.error(f"Filename generation failed: {e}")
        return None


def cleanup_text_chunk(chunk: str) -> str:
    """Clean a single chunk of text, removing formatting artifacts."""
    if not chunk.strip():
        return ""
    
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{LM_STUDIO_URL}/v1/chat/completions",
                json={
                    "model": _current_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": """Clean the following text for text-to-speech reading. You must REMOVE all of the following:
- Markdown formatting (**, *, #, ```, etc.)
- Page numbers and headers/footers
- Reference numbers like [1], (2), etc.
- Figure/table captions like "Fig. 1" or "Table 2"
- Excessive whitespace and blank lines

Keep the natural reading flow and all meaningful content. Ensure you remove bold and italicized text formatting. Output ONLY the cleaned text, nothing else."""
                        },
                        {
                            "role": "user",
                            "content": chunk
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4096
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"].strip()
            else:
                logger.warning(f"Cleanup request failed: {response.status_code}")
                return chunk  # Return original on failure
                
    except Exception as e:
        logger.error(f"Text cleanup failed: {e}")
        return chunk  # Return original on failure


def split_into_chunks(text: str) -> list[str]:
    """Split text into chunks for processing, preferring paragraph boundaries."""
    if len(text) <= CHUNK_SIZE:
        return [text]
    
    chunks = []
    current_pos = 0
    
    while current_pos < len(text):
        # Determine end position for this chunk
        end_pos = min(current_pos + CHUNK_SIZE, len(text))
        
        if end_pos < len(text):
            # Try to find a paragraph break
            chunk_text = text[current_pos:end_pos]
            
            # Look for paragraph break (double newline)
            para_break = chunk_text.rfind('\n\n')
            if para_break > CHUNK_SIZE // 2:
                end_pos = current_pos + para_break + 2
            else:
                # Look for single newline
                line_break = chunk_text.rfind('\n')
                if line_break > CHUNK_SIZE // 2:
                    end_pos = current_pos + line_break + 1
                else:
                    # Look for sentence end
                    sentence_end = max(
                        chunk_text.rfind('. '),
                        chunk_text.rfind('! '),
                        chunk_text.rfind('? ')
                    )
                    if sentence_end > CHUNK_SIZE // 2:
                        end_pos = current_pos + sentence_end + 2
        
        chunks.append(text[current_pos:end_pos])
        # Move forward with some overlap for context continuity
        current_pos = end_pos - CHUNK_OVERLAP if end_pos < len(text) else end_pos
    
    return chunks
