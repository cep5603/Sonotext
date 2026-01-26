"""
Qwen3-TTS Manager

Manages Qwen3-TTS models for text-to-speech generation.
Supports CustomVoice, VoiceDesign, and Base models.
"""

import os
import logging
import numpy as np
import torch
from dataclasses import dataclass
from typing import Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Qwen3TTSManager")

# Available models by type and size
QWEN3_MODELS = {
    # CustomVoice: Preset speakers with optional style instructions
    "custom-0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "custom-1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    # VoiceDesign: Create custom voice from natural language description
    "design-1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    # Base: Voice cloning from reference audio
    "base-0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "base-1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
}

# Model type extraction helper
def get_model_type(model_key: str) -> str:
    """Get model type from model key (e.g., 'custom-1.7B' -> 'custom')."""
    return model_key.split("-")[0]

def get_model_size(model_key: str) -> str:
    """Get model size from model key (e.g., 'custom-1.7B' -> '1.7B')."""
    return model_key.split("-")[1]

# Check CUDA availability
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {DEVICE}")
if DEVICE == "cuda":
    logger.info(f"GPU: {torch.cuda.get_device_name(0)}")


class Qwen3TTSManager:
    """Manages Qwen3-TTS model loading and audio generation.
    
    Supports three model types:
    - CustomVoice: Preset speakers with optional style instructions
    - VoiceDesign: Create custom voice from natural language description
    - Base: Voice cloning from reference audio
    """

    def __init__(self):
        self.model = None
        self.model_id: str | None = None
        self.model_key: str | None = None  # e.g., "custom-1.7B"
        self.speakers: list[str] = []
        self.languages: list[str] = []
        self._flash_attn_available: bool | None = None
        logger.info("Qwen3TTSManager initialized (model not loaded yet).")

    @property
    def is_loaded(self) -> bool:
        """Check if a model is currently loaded."""
        return self.model is not None

    @property
    def model_type(self) -> str | None:
        """Get the type of currently loaded model ('custom', 'design', or 'base')."""
        if self.model_key is None:
            return None
        return get_model_type(self.model_key)

    @property
    def model_size(self) -> str | None:
        """Get the size of the currently loaded model (e.g., '0.6B' or '1.7B')."""
        if self.model_key is None:
            return None
        return get_model_size(self.model_key)

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

    def load_model(self, model_key: str = "custom-1.7B") -> None:
        """
        Load a Qwen3-TTS model.

        Args:
            model_key: Model key like "custom-1.7B", "design-1.7B", or "base-1.7B"
        """
        # Handle legacy format (just size like "1.7B" -> "custom-1.7B")
        if model_key in ("0.6B", "1.7B"):
            model_key = f"custom-{model_key}"
            
        if model_key not in QWEN3_MODELS:
            raise ValueError(f"Invalid model key: {model_key}. Choose from: {list(QWEN3_MODELS.keys())}")

        model_id = QWEN3_MODELS[model_key]

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
        self.model_key = model_key

        # Get supported speakers and languages (if available for this model type)
        speakers = self.model.get_supported_speakers()
        languages = self.model.get_supported_languages()
        self.speakers = list(speakers) if speakers else []
        self.languages = list(languages) if languages else []

        logger.info(f"Loaded {model_id} (type={self.model_type}, size={self.model_size})")
        if self.speakers:
            logger.info(f"Speakers: {self.speakers}")
        if self.languages:
            logger.info(f"Languages: {self.languages}")

    def unload_model(self) -> None:
        """Unload the current model to free VRAM."""
        if self.model is not None:
            del self.model
            self.model = None
            self.model_id = None
            self.model_key = None
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
            "model_key": self.model_key,
            "model_type": self.model_type,
            "model_size": self.model_size,
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
        max_new_tokens: int = 8192,
    ) -> tuple[np.ndarray, int]:
        """
        Generate audio from text using Qwen3-TTS CustomVoice model.

        Args:
            text: The text to synthesize
            speaker: Speaker name (from get_voices())
            language: Target language or "Auto" for detection
            instruct: Optional emotional/style instruction (e.g., "Speak happily")
            max_new_tokens: Maximum audio tokens to generate

        Returns:
            Tuple of (audio_data as numpy array, sample_rate)
        """
        if not self.is_loaded:
            raise RuntimeError(
                "Qwen3-TTS model not loaded. Call load_model() first."
            )
        
        if self.model_type != "custom":
            raise RuntimeError(
                f"generate_audio requires CustomVoice model, but {self.model_type} is loaded."
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
            max_new_tokens=max_new_tokens,
        )

        # Return first wav (single inference)
        return wavs[0], sr

    # Voice Design Methods (requires VoiceDesign model)

    def generate_voice_design(
        self,
        text: str,
        voice_description: str,
        language: str = "Auto",
        max_new_tokens: int = 2048,
    ) -> tuple[np.ndarray, int]:
        """
        Generate audio with a custom-designed voice using natural language description.
        
        Requires VoiceDesign model to be loaded.

        Args:
            text: The text to synthesize
            voice_description: Natural language description of desired voice
                              (e.g., "Male, 35 years old, baritone, calm and professional")
            language: Target language or "Auto" for detection
            max_new_tokens: Maximum audio tokens to generate

        Returns:
            Tuple of (audio_data as numpy array, sample_rate)
        """
        if not self.is_loaded:
            raise RuntimeError("Qwen3-TTS model not loaded. Call load_model('design-1.7B') first.")
        
        if self.model_type != "design":
            raise RuntimeError(
                f"generate_voice_design requires VoiceDesign model, but {self.model_type} is loaded. "
                f"Call load_model('design-1.7B') first."
            )

        wavs, sr = self.model.generate_voice_design(
            text=text,
            instruct=voice_description,
            language=language,
            max_new_tokens=max_new_tokens,
        )

        return wavs[0], sr

    # Voice Clone Methods (requires Base model)

    def create_voice_clone_prompt(
        self,
        ref_audio: np.ndarray,
        ref_audio_sr: int,
        ref_text: str,
    ):
        """
        Create a reusable voice clone prompt from reference audio.
        
        Requires Base model to be loaded.

        Args:
            ref_audio: Reference audio waveform (numpy array)
            ref_audio_sr: Sample rate of reference audio
            ref_text: Transcript of the reference audio

        Returns:
            VoiceClonePromptItem that can be reused for multiple generations
        """
        if not self.is_loaded:
            raise RuntimeError("Qwen3-TTS model not loaded. Call load_model('base-1.7B') first.")
        
        if self.model_type != "base":
            raise RuntimeError(
                f"create_voice_clone_prompt requires Base model, but {self.model_type} is loaded. "
                f"Call load_model('base-1.7B') first."
            )

        prompt_items = self.model.create_voice_clone_prompt(
            ref_audio=(ref_audio, ref_audio_sr),
            ref_text=ref_text,
            x_vector_only_mode=False,  # Use ICL mode for best quality
        )

        # Return single prompt item (we only passed one reference)
        return prompt_items[0]

    def generate_voice_clone(
        self,
        text: str,
        voice_clone_prompt,
        language: str = "Auto",
        max_new_tokens: int = 2048,
    ) -> tuple[np.ndarray, int]:
        """
        Generate audio using a cloned voice.
        
        Requires Base model to be loaded.

        Args:
            text: The text to synthesize
            voice_clone_prompt: VoiceClonePromptItem from create_voice_clone_prompt()
            language: Target language or "Auto" for detection
            max_new_tokens: Maximum audio tokens to generate

        Returns:
            Tuple of (audio_data as numpy array, sample_rate)
        """
        if not self.is_loaded:
            raise RuntimeError("Qwen3-TTS model not loaded. Call load_model('base-1.7B') first.")
        
        if self.model_type != "base":
            raise RuntimeError(
                f"generate_voice_clone requires Base model, but {self.model_type} is loaded. "
                f"Call load_model('base-1.7B') first."
            )

        wavs, sr = self.model.generate_voice_clone(
            text=text,
            language=language,
            voice_clone_prompt=[voice_clone_prompt],  # Wrap in list as expected by API
            max_new_tokens=max_new_tokens,
        )

        return wavs[0], sr


# Singleton instance
qwen3_manager = Qwen3TTSManager()
