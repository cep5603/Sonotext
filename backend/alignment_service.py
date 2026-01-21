"""
Alignment Service - Audio-to-text forced alignment using ctc-forced-aligner.

Provides word-level timestamps by aligning known text to generated audio.
"""

import os
import json
import logging
from dataclasses import dataclass, asdict
from typing import Optional

import torch

logger = logging.getLogger("AlignmentService")

# Lazy-loaded model references
_alignment_model = None
_alignment_tokenizer = None


@dataclass
class WordTiming:
    """Timing information for a single word."""
    word: str
    start: float  # Start time in seconds
    end: float  # End time in seconds
    char_start: int  # Character offset in original text
    char_end: int  # Character end offset


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


def get_language_code(voice: str) -> str:
    """
    Map Kokoro voice ID to ISO-639-3 language code for alignment.
    
    Kokoro uses single-letter prefixes:
    - a: American English
    - b: British English  
    - j: Japanese
    - z: Mandarin Chinese
    - e: Spanish
    - f: French
    - h: Hindi
    - i: Italian
    - p: Portuguese
    """
    prefix_to_iso = {
        'a': 'eng',  # American English
        'b': 'eng',  # British English (same ISO code)
        'j': 'jpn',  # Japanese
        'z': 'cmn',  # Mandarin Chinese
        'e': 'spa',  # Spanish
        'f': 'fra',  # French
        'h': 'hin',  # Hindi
        'i': 'ita',  # Italian
        'p': 'por',  # Portuguese
    }
    
    if voice and len(voice) > 0:
        return prefix_to_iso.get(voice[0], 'eng')
    return 'eng'


def align_audio_to_text(
    audio_path: str,
    text: str,
    language: str = "eng",
    batch_size: int = 16
) -> list[WordTiming]:
    """
    Perform forced alignment between audio and text.
    
    Args:
        audio_path: Path to the audio file (.wav)
        text: The original text that was synthesized
        language: ISO-639-3 language code (e.g., 'eng', 'fra', 'jpn')
        batch_size: Batch size for processing
        
    Returns:
        List of WordTiming objects with timestamps for each word
    """
    from ctc_forced_aligner import (
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )
    import soundfile as sf
    from scipy import signal
    
    _ensure_model_loaded()
    
    # Load audio using soundfile (completely bypasses TorchCodec)
    audio_data, sample_rate = sf.read(audio_path, dtype='float32')
    
    # Convert to mono if stereo
    if len(audio_data.shape) > 1:
        audio_data = audio_data.mean(axis=1)
    
    # Resample to 16kHz (required by alignment model)
    if sample_rate != 16000:
        num_samples = int(len(audio_data) * 16000 / sample_rate)
        audio_data = signal.resample(audio_data, num_samples)
    
    # Convert to torch tensor and move to device
    audio_waveform = torch.from_numpy(audio_data).to(
        dtype=_alignment_model.dtype, 
        device=_alignment_model.device
    )
    
    # Generate CTC emissions
    emissions, stride = generate_emissions(
        _alignment_model, 
        audio_waveform, 
        batch_size=batch_size
    )
    
    # Preprocess text for alignment
    tokens_starred, text_starred = preprocess_text(
        text,
        romanize=True,
        language=language,
    )
    
    # Perform alignment
    segments, scores, blank_token = get_alignments(
        emissions,
        tokens_starred,
        _alignment_tokenizer,
    )
    
    # Get word spans
    spans = get_spans(tokens_starred, segments, blank_token)
    
    # Post-process to get word timestamps
    word_timestamps = postprocess_results(text_starred, spans, stride, scores)
    
    # Convert to WordTiming objects with character offsets
    result = []
    char_offset = 0
    
    for item in word_timestamps:
        word = item["text"]
        start = item["start"]
        end = item["end"]
        
        # Find the word in the original text to get character offsets
        # Handle potential whitespace differences
        word_clean = word.strip()
        
        # Skip to the word position in original text
        while char_offset < len(text) and text[char_offset].isspace():
            char_offset += 1
        
        char_start = char_offset
        char_end = char_start + len(word_clean)
        char_offset = char_end
        
        result.append(WordTiming(
            word=word_clean,
            start=start,
            end=end,
            char_start=char_start,
            char_end=char_end
        ))
    
    return result


def save_alignment(
    alignment: list[WordTiming], 
    output_path: str
) -> None:
    """Save alignment data to a JSON file."""
    data = {
        "words": [asdict(w) for w in alignment],
        "version": 1
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
