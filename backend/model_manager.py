import os
import json
import logging
from huggingface_hub import hf_hub_download
from kokoro_onnx import Kokoro
import soundfile as sf
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoroManager")

MODEL_REPO = "remsky/kokoro-82m-mirror"
ONNX_FILENAME = "kokoro-v0_19.onnx"
VOICES_REPO = "ecyht2/kokoro-82M-voices"
VOICES_FILENAME = "voices.json"
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "weights")

class ModelManager:
    def __init__(self):
        self.kokoro: Kokoro | None = None
        self.voices = {}
        self.ensure_setup()

    def ensure_setup(self):
        """Ensure necessary model files exist and load the model."""
        os.makedirs(WEIGHTS_DIR, exist_ok=True)
        
        final_onnx_path = os.path.join(WEIGHTS_DIR, "kokoro.onnx")
        voices_path = os.path.join(WEIGHTS_DIR, VOICES_FILENAME)

        # 1. Download ONNX Model
        if not os.path.exists(final_onnx_path):
            logger.info(f"Downloading {ONNX_FILENAME} from {MODEL_REPO}...")
            try:
                hf_hub_download(repo_id=MODEL_REPO, filename=ONNX_FILENAME, local_dir=WEIGHTS_DIR)
                
                # Move from weights/kokoro-v0_19.onnx to weights/kokoro.onnx
                downloaded_path = os.path.join(WEIGHTS_DIR, ONNX_FILENAME)
                if os.path.exists(downloaded_path):
                    import shutil
                    shutil.move(downloaded_path, final_onnx_path)
            except Exception as e:
                logger.error(f"Failed to download model: {e}")
                raise

        # 2. Download Voices
        if not os.path.exists(voices_path):
            logger.info(f"Downloading {VOICES_FILENAME} from {VOICES_REPO}...")
            try:
                hf_hub_download(repo_id=VOICES_REPO, filename=VOICES_FILENAME, local_dir=WEIGHTS_DIR, repo_type="dataset")
            except Exception as e:
                logger.error(f"Failed to download voices: {e}")
                raise

        logger.info("Loading Kokoro ONNX model...")
        self.kokoro = Kokoro(final_onnx_path, voices_path)
        
        
        # Load available voices
        with open(voices_path, 'r') as f:
            self.voices = json.load(f)
        
        logger.info("Model loaded successfully.")
        
        # Load available voices
        with open(voices_path, 'r') as f:
            self.voices = json.load(f)
        
        logger.info("Model loaded successfully.")

    def generate_audio(self, text: str, voice: str, speed: float = 1.0):
        if not self.kokoro:
            raise RuntimeError("Model not initialized.")
        
        # Kokoro expects specific voice keys. 
        # The voices.json usually contains the embedding vectors.
        # kokoro-onnx's create method takes the voice name which matches a key in voices.json
        
        # Ensure voice exists
        if voice not in self.voices:
            # Fallback to a default if possible or raise error
            logger.warning(f"Voice {voice} not found. Using default 'af_sarah' if available.")
            voice = "af_sarah" # Common default in Kokoro

        samples, sample_rate = self.kokoro.create(
            text, 
            voice=voice, 
            speed=speed, 
            lang="en-us"
        )
        return samples, sample_rate

model_manager = ModelManager()
