import os
import logging
import numpy as np
from language_utils import resolve_kokoro_language_code

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoroManager")

# Full voice list by language
VOICES = {
    "American English": [
        "af_bella", "af_nova", "af_alloy", "af_aoede", "af_jessica", "af_kore",
        "af_nicole", "af_river", "af_heart", "af_sarah", "af_sky",
        "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
        "am_onyx", "am_puck", "am_santa"
    ],
    "British English": [
        "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
        "bm_daniel", "bm_fable", "bm_george", "bm_lewis"
    ],
    "Japanese": ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
    "Mandarin Chinese": [
        "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi",
        "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"
    ],
    "Spanish": ["ef_dora", "em_alex", "em_santa"],
    "French": ["ff_siwis"],
    "Hindi": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
    "Italian": ["if_sara", "im_nicola"],
    "Portuguese": ["pf_dora", "pm_alex", "pm_santa"]
}


class ModelManager:
    def __init__(self):
        self.pipelines: dict = {}
        self.voices: list[str] = []
        self._device = None
        self._load_voices()
        logger.info("ModelManager initialized.")

    def _get_device(self):
        if self._device is None:
            import torch
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            logger.info(f"Using device: {self._device}")
            if self._device == "cuda":
                logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
        return self._device

    def _load_voices(self):
        """Flatten voice list from all languages."""
        for lang_voices in VOICES.values():
            self.voices.extend(lang_voices)
        logger.info(f"Loaded {len(self.voices)} voices")

    def _get_pipeline(self, lang_code: str):
        """Get or create a pipeline for the given language code."""
        if lang_code not in self.pipelines:
            self._get_device()
            from kokoro import KPipeline
            logger.info(f"Creating pipeline for lang_code: {lang_code}")
            self.pipelines[lang_code] = KPipeline(lang_code=lang_code)
        return self.pipelines[lang_code]

    def get_loaded_pipelines(self) -> dict[str, bool]:
        """Return a dict of lang_code -> True for all loaded pipelines."""
        return {code: True for code in self.pipelines}

    def unload_pipeline(self, lang_code: str) -> bool:
        """Unload a specific language pipeline to free memory."""
        if lang_code not in self.pipelines:
            return False
        del self.pipelines[lang_code]
        logger.info(f"Unloaded Kokoro pipeline for lang_code: {lang_code}")
        return True

    def unload_all_pipelines(self) -> None:
        """Unload all language pipelines."""
        count = len(self.pipelines)
        self.pipelines.clear()
        logger.info(f"Unloaded all {count} Kokoro pipelines.")

    def generate_audio(self, text: str, voice: str, speed: float = 1.0, lang_override: str | None = None):
        if voice not in self.voices:
            logger.warning(f"Voice {voice} not found. Using default 'af_heart'.")
            voice = "af_heart"

        lang_code = resolve_kokoro_language_code(voice, lang_override)

        pipeline = self._get_pipeline(lang_code)
        
        # Generate audio using the pipeline (collect all segments)
        audio_segments = []
        for gs, ps, audio in pipeline(text, voice=voice, speed=speed):
            if audio is not None and len(audio) > 0:
                audio_segments.append(audio)
        
        if not audio_segments:
            raise RuntimeError("Failed to generate audio")
        
        audio_data = np.concatenate(audio_segments)
        
        return audio_data, 24000  # Kokoro uses 24kHz sample rate


model_manager = ModelManager()
