"""
Qwen3-TTS Manager

Manages Qwen3-TTS models for text-to-speech generation.
Supports both 0.6B and 1.7B CustomVoice models.
"""

import os
import logging
import numpy as np
import torch

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Qwen3TTSManager")

# Available models
QWEN3_MODELS = {
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
}

# Check CUDA availability
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {DEVICE}")
if DEVICE == "cuda":
    logger.info(f"GPU: {torch.cuda.get_device_name(0)}")


class Qwen3TTSManager:
    """Manages Qwen3-TTS model loading and audio generation."""

    def __init__(self):
        self.model = None
        self.model_id: str | None = None
        self.speakers: list[str] = []
        self.languages: list[str] = []
        self._flash_attn_available: bool | None = None
        logger.info("Qwen3TTSManager initialized (model not loaded yet).")

    @property
    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        return self.model is not None

    @property
    def model_size(self) -> str | None:
        """Get the size of the currently loaded model (e.g., '0.6B' or '1.7B')."""
        if self.model_id is None:
            return None
        for size, model_id in QWEN3_MODELS.items():
            if model_id == self.model_id:
                return size
        return None

    def _check_flash_attention(self) -> bool:
        """Check if FlashAttention 2 is available."""
        if self._flash_attn_available is not None:
            return self._flash_attn_available

        try:
            import flash_attn  # noqa: F401
            self._flash_attn_available = True
            logger.info("FlashAttention 2 is available.")
        except ImportError:
            self._flash_attn_available = False
            logger.warning(
                "FlashAttention 2 not installed. "
                "For better VRAM efficiency, install with: "
                "pip install flash-attn --no-build-isolation"
            )
        return self._flash_attn_available

    def load_model(self, model_size: str = "1.7B") -> None:
        """
        Load a Qwen3-TTS model.

        Args:
            model_size: Either "0.6B" or "1.7B"
        """
        if model_size not in QWEN3_MODELS:
            raise ValueError(f"Invalid model size: {model_size}. Choose from: {list(QWEN3_MODELS.keys())}")

        model_id = QWEN3_MODELS[model_size]

        # Don't reload if same model already loaded
        if self.model is not None and self.model_id == model_id:
            logger.info(f"Model {model_id} already loaded.")
            return

        # Unload existing model if different
        if self.model is not None:
            self.unload_model()

        logger.info(f"Loading Qwen3-TTS model: {model_id}")

        from qwen_tts import Qwen3TTSModel

        # Determine attention implementation
        use_flash_attn = self._check_flash_attention()
        attn_impl = "flash_attention_2" if use_flash_attn else "sdpa"

        self.model = Qwen3TTSModel.from_pretrained(
            model_id,
            device_map="cuda:0" if DEVICE == "cuda" else "cpu",
            dtype=torch.bfloat16 if DEVICE == "cuda" else torch.float32,
            attn_implementation=attn_impl,
        )
        self.model_id = model_id

        # Get supported speakers and languages
        self.speakers = list(self.model.get_supported_speakers())
        self.languages = list(self.model.get_supported_languages())

        logger.info(f"Loaded {model_id} with {len(self.speakers)} speakers, {len(self.languages)} languages")
        logger.info(f"Speakers: {self.speakers}")
        logger.info(f"Languages: {self.languages}")

    def unload_model(self) -> None:
        """Unload the current model to free VRAM."""
        if self.model is not None:
            del self.model
            self.model = None
            self.model_id = None
            self.speakers = []
            self.languages = []
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
            logger.info("Qwen3-TTS model unloaded.")

    def get_voices(self) -> list[dict]:
        """
        Get list of available voices in a standardized format.

        Returns:
            List of voice dicts with id, name, language, gender
        """
        if not self.is_loaded:
            # Return static list if model not loaded
            return self._get_static_voice_list()

        # Build voice list from model's speakers
        voices = []
        for speaker in self.speakers:
            voices.append({
                "id": speaker,
                "name": speaker,
                "language": "Multi",  # All speakers support all languages
                "gender": self._infer_gender(speaker),
            })
        return voices

    def _get_static_voice_list(self) -> list[dict]:
        """Static voice list when model isn't loaded."""
        # Actual speakers from Qwen3-TTS-12Hz-1.7B-CustomVoice
        known_speakers = [
            ("aiden", "M", "English"),
            ("dylan", "M", "English"),
            ("eric", "M", "English"),
            ("ono_anna", "F", "Japanese"),
            ("ryan", "M", "English"),
            ("serena", "F", "English"),
            ("sohee", "F", "Korean"),
            ("uncle_fu", "M", "Chinese"),
            ("vivian", "F", "Chinese"),
        ]
        return [
            {"id": name, "name": name.replace("_", " ").title(), "language": lang, "gender": gender}
            for name, gender, lang in known_speakers
        ]

    def _infer_gender(self, speaker: str) -> str:
        """Infer gender from speaker name (fallback heuristic)."""
        male_names = {"aiden", "dylan", "eric", "ryan", "uncle_fu"}
        return "M" if speaker.lower() in male_names else "F"

    def get_model_info(self) -> dict:
        """Get info about the currently loaded model."""
        return {
            "loaded": self.is_loaded,
            "model_id": self.model_id,
            "model_size": next(
                (k for k, v in QWEN3_MODELS.items() if v == self.model_id), None
            ),
            "speakers": self.speakers,
            "languages": self.languages,
            "flash_attention": self._flash_attn_available,
        }

    def generate_audio(
        self,
        text: str,
        speaker: str = "ryan",
        language: str = "Auto",
        instruct: str | None = None,
    ) -> tuple[np.ndarray, int]:
        """
        Generate audio from text using Qwen3-TTS.

        Args:
            text: The text to synthesize
            speaker: Speaker name (from get_voices())
            language: Target language or "Auto" for detection
            instruct: Optional emotional/style instruction (e.g., "Speak happily")

        Returns:
            Tuple of (audio_data as numpy array, sample_rate)
        """
        if not self.is_loaded:
            raise RuntimeError(
                "Qwen3-TTS model not loaded. Call load_model() first or use /api/qwen3/load endpoint."
            )

        # Validate speaker (case-insensitive)
        speaker_lower = speaker.lower()
        speakers_lower = [s.lower() for s in self.speakers]
        if speaker_lower not in speakers_lower:
            logger.warning(f"Speaker '{speaker}' not found. Using first available speaker.")
            speaker = self.speakers[0] if self.speakers else "ryan"
        else:
            # Use the exact case from the model's speaker list
            speaker = self.speakers[speakers_lower.index(speaker_lower)]

        # Generate audio
        wavs, sr = self.model.generate_custom_voice(
            text=text,
            language=language,
            speaker=speaker,
            instruct=instruct or "",
        )

        # Return first wav (single inference)
        return wavs[0], sr


# Singleton instance
qwen3_manager = Qwen3TTSManager()
