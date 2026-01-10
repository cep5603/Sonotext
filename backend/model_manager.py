import os
import logging
import numpy as np
import torch
from kokoro import KPipeline

# Set HuggingFace cache to project directory for portability
os.environ["HF_HOME"] = os.path.join(os.path.dirname(__file__), "hub")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KokoroManager")

# Check CUDA availability
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {DEVICE}")
if DEVICE == "cuda":
    logger.info(f"GPU: {torch.cuda.get_device_name(0)}")

# Language code mapping from voice prefix
LANG_CODE_MAP = {
    'a': 'a',  # American English
    'b': 'b',  # British English
    'j': 'j',  # Japanese
    'z': 'z',  # Mandarin Chinese
    'e': 'e',  # Spanish
    'f': 'f',  # French
    'h': 'h',  # Hindi
    'i': 'i',  # Italian
    'p': 'p',  # Portuguese
}

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
        self.pipelines: dict[str, KPipeline] = {}
        self.voices: list[str] = []
        self._load_voices()
        logger.info("ModelManager initialized.")

    def _load_voices(self):
        """Flatten voice list from all languages."""
        for lang_voices in VOICES.values():
            self.voices.extend(lang_voices)
        logger.info(f"Loaded {len(self.voices)} voices")

    def _get_lang_code(self, voice: str) -> str:
        """Get language code from voice prefix."""
        if not voice:
            return 'a'
        prefix = voice[0]
        return LANG_CODE_MAP.get(prefix, 'a')

    def _get_pipeline(self, lang_code: str) -> KPipeline:
        """Get or create a pipeline for the given language code."""
        if lang_code not in self.pipelines:
            logger.info(f"Creating pipeline for lang_code: {lang_code}")
            self.pipelines[lang_code] = KPipeline(lang_code=lang_code)
        return self.pipelines[lang_code]

    def generate_audio(self, text: str, voice: str, speed: float = 1.0, lang_override: str | None = None):
        if voice not in self.voices:
            logger.warning(f"Voice {voice} not found. Using default 'af_heart'.")
            voice = "af_heart"

        # Determine language code
        if lang_override:
            # Map espeak codes to kokoro lang codes
            espeak_to_kokoro = {
                'en-us': 'a', 'en-gb': 'b', 'es': 'e', 
                'fr-fr': 'f', 'hi': 'h', 'it': 'i', 'pt-br': 'p'
            }
            lang_code = espeak_to_kokoro.get(lang_override, self._get_lang_code(voice))
        else:
            lang_code = self._get_lang_code(voice)

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
