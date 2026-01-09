import os
import logging
import requests
import numpy as np
from kokoro_onnx import Kokoro

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoroManager")

# v1.0 model files from GitHub releases
BASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
VOICES_URL = f"{BASE_URL}/voices-v1.0.bin"
VOICES_FILENAME = "voices-v1.0.bin"
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "weights")

# Model precision options
MODEL_VARIANTS = {
    "fp32": {"filename": "kokoro-v1.0.onnx", "size": "310 MB", "gpu": False},
    "fp16": {"filename": "kokoro-v1.0.fp16.onnx", "size": "169 MB", "gpu": False},
    "fp16-gpu": {"filename": "kokoro-v1.0.fp16-gpu.onnx", "size": "169 MB", "gpu": True},
    "int8": {"filename": "kokoro-v1.0.int8.onnx", "size": "88 MB", "gpu": False},
}

class ModelManager:
    def __init__(self):
        self.kokoro: Kokoro | None = None
        self.voices: list[str] = []
        self.current_precision: str = "fp32"
        self._load_saved_precision()
        self.ensure_setup()

    def _load_saved_precision(self):
        """Load saved precision preference."""
        config_path = os.path.join(WEIGHTS_DIR, "precision.txt")
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    precision = f.read().strip()
                    if precision in MODEL_VARIANTS:
                        self.current_precision = precision
            except Exception:
                pass

    def _save_precision(self, precision: str):
        """Save precision preference."""
        os.makedirs(WEIGHTS_DIR, exist_ok=True)
        config_path = os.path.join(WEIGHTS_DIR, "precision.txt")
        with open(config_path, 'w') as f:
            f.write(precision)

    def _download_file(self, url: str, dest_path: str):
        """Download a file from URL with progress logging."""
        logger.info(f"Downloading {url}...")
        response = requests.get(url, stream=True)
        response.raise_for_status()
        total_size = int(response.headers.get('content-length', 0))
        
        with open(dest_path, 'wb') as f:
            downloaded = 0
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    progress = (downloaded / total_size) * 100
                    if downloaded % (10 * 1024 * 1024) < 8192:
                        logger.info(f"Download progress: {progress:.1f}%")
        
        logger.info(f"Downloaded {dest_path}")

    def get_precision_options(self) -> list[dict]:
        """Get available precision options with their details."""
        options = []
        for key, info in MODEL_VARIANTS.items():
            model_path = os.path.join(WEIGHTS_DIR, info["filename"])
            options.append({
                "id": key,
                "filename": info["filename"],
                "size": info["size"],
                "gpu": info.get("gpu", False),
                "downloaded": os.path.exists(model_path),
                "active": key == self.current_precision
            })
        return options

    def set_precision(self, precision: str) -> bool:
        """Change model precision (downloads if needed, reloads model)."""
        if precision not in MODEL_VARIANTS:
            return False
        
        self.current_precision = precision
        self._save_precision(precision)
        self._load_model()
        return True

    def _load_model(self):
        """Load the model with current precision setting."""
        variant = MODEL_VARIANTS[self.current_precision]
        model_filename = variant["filename"]
        model_path = os.path.join(WEIGHTS_DIR, model_filename)
        voices_path = os.path.join(WEIGHTS_DIR, VOICES_FILENAME)

        # Download model if needed
        if not os.path.exists(model_path):
            model_url = f"{BASE_URL}/{model_filename}"
            logger.info(f"Downloading {model_filename}...")
            try:
                self._download_file(model_url, model_path)
            except Exception as e:
                logger.error(f"Failed to download model: {e}")
                raise

        # Download voices if needed
        if not os.path.exists(voices_path):
            logger.info(f"Downloading {VOICES_FILENAME}...")
            try:
                self._download_file(VOICES_URL, voices_path)
            except Exception as e:
                logger.error(f"Failed to download voices: {e}")
                raise

        logger.info(f"Loading Kokoro ONNX model ({self.current_precision})...")
        self.kokoro = Kokoro(model_path, voices_path)
        
        # Load available voices from the .bin file
        try:
            with np.load(voices_path) as data:
                self.voices = list(data.files)
            logger.info(f"Loaded {len(self.voices)} voices")
        except Exception as e:
            logger.warning(f"Could not load voice list from bin file: {e}")
            self.voices = ["af_sarah", "af_sky", "am_adam", "am_michael"]
        
        logger.info("Model loaded successfully.")

    def ensure_setup(self):
        """Ensure necessary model files exist and load the model."""
        os.makedirs(WEIGHTS_DIR, exist_ok=True)
        self._load_model()

    def _get_lang_for_voice(self, voice: str) -> str:
        """Determine the language code based on voice prefix.
        
        Note: kokoro-onnx uses espeak-ng for phoneme conversion.
        Not all languages are fully supported by espeak-ng.
        Unsupported languages fall back to English phonemes.
        """
        # Voice naming: {lang_prefix}{gender}_{name}
        # e.g., af_sarah = American Female, jm_kumo = Japanese Male
        prefix = voice[0] if voice else 'a'
        
        # Only include languages supported by espeak-ng
        # Languages like Japanese (j), Chinese (z) don't have good espeak support
        # and the model handles them differently
        lang_map = {
            'a': 'en-us',  # American English
            'b': 'en-gb',  # British English
            'e': 'es',     # Spanish
            'f': 'fr-fr',  # French
            'h': 'hi',     # Hindi
            'i': 'it',     # Italian
            'p': 'pt-br',  # Brazilian Portuguese
            # Japanese (j), Chinese (z) - use en-us as fallback, 
            # model uses internal phonemes for these
            'j': 'en-us',
            'z': 'en-us',
        }
        return lang_map.get(prefix, 'en-us')

    def generate_audio(self, text: str, voice: str, speed: float = 1.0, lang_override: str | None = None):
        if not self.kokoro:
            raise RuntimeError("Model not initialized.")
        
        if voice not in self.voices:
            logger.warning(f"Voice {voice} not found. Using default 'af_sarah'.")
            voice = "af_sarah"

        # Use override if provided, otherwise auto-detect from voice
        lang = lang_override if lang_override else self._get_lang_for_voice(voice)
        samples, sample_rate = self.kokoro.create(
            text, 
            voice=voice, 
            speed=speed, 
            lang=lang
        )
        return samples, sample_rate

model_manager = ModelManager()
