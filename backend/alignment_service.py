"""
Alignment Service - Audio-to-text forced alignment using ctc-forced-aligner.

Provides word-level timestamps by aligning known text to generated audio.
"""

import json
import logging
import os
from dataclasses import asdict
from typing import Optional

import torch

from alignment_ctc import (
    ALIGNMENT_SAMPLE_RATE,
    align_audio_to_text_in_chunks as _ctc_align_audio_to_text_in_chunks,
    align_waveform_to_text as _ctc_align_waveform_to_text,
    build_word_timings as _build_word_timings,
    split_text_into_chunks as _split_text_into_chunks,
)
from alignment_types import WordTiming
from alignment_whisper import (
    align_long_audio_with_whisper as _align_long_audio_with_whisper,
)

logger = logging.getLogger("AlignmentService")

DEFAULT_ALIGNMENT_CHUNK_SIZE = 500
LONG_ALIGNMENT_MIN_DURATION_SECONDS = 15 * 60
LONG_ALIGNMENT_MIN_TEXT_LENGTH = 15_000
LONG_ALIGNMENT_MIN_GENERATION_CHUNKS = 20

# Lazy-loaded model references
_alignment_model = None
_alignment_tokenizer = None


def _should_use_chunked_alignment(text: str, duration_seconds: Optional[float], chunk_size: int) -> bool:
    generation_chunks = _split_text_into_chunks(text, max_chars=chunk_size)
    if len(generation_chunks) <= 1:
        return False

    if len(text) >= LONG_ALIGNMENT_MIN_TEXT_LENGTH:
        return True

    if duration_seconds is not None and duration_seconds >= LONG_ALIGNMENT_MIN_DURATION_SECONDS:
        return True

    return len(generation_chunks) >= LONG_ALIGNMENT_MIN_GENERATION_CHUNKS


def _align_waveform_to_text(
    audio_waveform: torch.Tensor,
    text: str,
    language: str,
    batch_size: int,
) -> list[dict]:
    return _ctc_align_waveform_to_text(
        audio_waveform,
        text,
        language,
        batch_size,
        _alignment_model,
        _alignment_tokenizer,
    )


def _align_audio_to_text_in_chunks(
    audio_path: str,
    text: str,
    language: str,
    batch_size: int,
    chunk_size: int,
    total_duration: Optional[float],
) -> list[WordTiming]:
    return _ctc_align_audio_to_text_in_chunks(
        audio_path,
        text,
        language,
        batch_size,
        chunk_size,
        total_duration,
        _alignment_model,
        _alignment_tokenizer,
    )


def _get_device() -> str:
    """Get the best available device."""
    return "cuda" if torch.cuda.is_available() else "cpu"


def _get_dtype():
    """Get optimal dtype for device."""
    return torch.float16 if torch.cuda.is_available() else torch.float32


def _ensure_model_loaded():
    """Lazily load the alignment model on first use."""
    global _alignment_model, _alignment_tokenizer
    
    if _alignment_model is not None:
        return
    
    from ctc_forced_aligner import load_alignment_model
    
    device = _get_device()
    dtype = _get_dtype()
    
    logger.info(f"Loading alignment model on {device} with {dtype}")
    _alignment_model, _alignment_tokenizer = load_alignment_model(device, dtype=dtype)
    logger.info("Alignment model loaded successfully")


def is_loaded() -> bool:
    """Check if the alignment model is currently loaded in memory."""
    return _alignment_model is not None


def load_model():
    """Explicitly load the alignment model into memory."""
    _ensure_model_loaded()


def unload_model():
    """Unload the alignment model to free VRAM."""
    global _alignment_model, _alignment_tokenizer
    
    if _alignment_model is None:
        return
    
    import torch
    
    del _alignment_model
    del _alignment_tokenizer
    _alignment_model = None
    _alignment_tokenizer = None
    
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    logger.info("Alignment model unloaded")


def align_audio_to_text(
    audio_path: str,
    text: str,
    language: str = "eng",
    batch_size: int = 16,
    chunk_size: int | None = None,
    total_duration: float | None = None,
) -> list[WordTiming]:
    """
    Perform forced alignment between audio and text.
    
    Args:
        audio_path: Path to the audio file (.wav)
        text: The original text that was synthesized
        language: ISO-639-3 language code (e.g., 'eng', 'fra', 'jpn')
        batch_size: Batch size for processing
        chunk_size: Original generation chunk size, when available
        total_duration: Audio duration in seconds, when already known
        
    Returns:
        List of WordTiming objects with timestamps for each word
    """
    import soundfile as sf
    from scipy import signal

    effective_chunk_size = chunk_size or DEFAULT_ALIGNMENT_CHUNK_SIZE
    if _should_use_chunked_alignment(text, total_duration, effective_chunk_size):
        try:
            return _align_long_audio_with_whisper(audio_path, text, language, total_duration)
        except Exception as error:
            logger.warning("Whisper-based long alignment failed, falling back to CTC chunking: %s", error)
            _ensure_model_loaded()
            return _align_audio_to_text_in_chunks(
                audio_path=audio_path,
                text=text,
                language=language,
                batch_size=batch_size,
                chunk_size=effective_chunk_size,
                total_duration=total_duration,
            )

    _ensure_model_loaded()
    
    # Load audio using soundfile (completely bypasses TorchCodec)
    audio_data, sample_rate = sf.read(audio_path, dtype='float32')
    
    # Convert to mono if stereo
    if len(audio_data.shape) > 1:
        audio_data = audio_data.mean(axis=1)
    
    # Resample to 16kHz (required by alignment model)
    if sample_rate != ALIGNMENT_SAMPLE_RATE:
        num_samples = int(len(audio_data) * ALIGNMENT_SAMPLE_RATE / sample_rate)
        audio_data = signal.resample(audio_data, num_samples)
    
    # Convert to torch tensor and move to device
    audio_waveform = torch.from_numpy(audio_data).to(
        dtype=_alignment_model.dtype, 
        device=_alignment_model.device
    )

    word_timestamps = _align_waveform_to_text(audio_waveform, text, language, batch_size)
    result, _ = _build_word_timings(word_timestamps, text, 0)
    return result


def save_alignment(
    alignment: list[WordTiming], 
    output_path: str
) -> None:
    """Save alignment data to a JSON file."""
    data = {
        "words": [asdict(w) for w in alignment],
    }
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_alignment(alignment_path: str) -> Optional[list[WordTiming]]:
    """Load alignment data from a JSON file."""
    if not os.path.exists(alignment_path):
        return None
        
    with open(alignment_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    return [
        WordTiming(
            word=w["word"],
            start=w["start"],
            end=w["end"],
            char_start=w["char_start"],
            char_end=w["char_end"]
        )
        for w in data.get("words", [])
    ]


def get_alignment_path(audio_path: str) -> str:
    """Get the alignment JSON path for an audio file."""
    base, _ = os.path.splitext(audio_path)
    return f"{base}.alignment.json"
