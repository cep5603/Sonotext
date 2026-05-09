"""CTC-based alignment helpers and long-file fallback alignment."""

import logging
import math
import re
from typing import Optional

import numpy as np
import torch

from alignment_types import WordTiming, stabilize_word_timings

logger = logging.getLogger("AlignmentService")

ALIGNMENT_SAMPLE_RATE = 16000
ALIGNMENT_GROUP_CHAR_LIMIT = 2_000
ALIGNMENT_MIN_ESTIMATED_CHUNK_SECONDS = 3.0
ALIGNMENT_WINDOW_MIN_MARGIN_SECONDS = 2.0
ALIGNMENT_WINDOW_MAX_MARGIN_SECONDS = 8.0
ALIGNMENT_WINDOW_MARGIN_RATIO = 0.05
ALIGNMENT_WINDOW_RETRY_MULTIPLIERS = (1.0, 2.0, 4.0, 8.0)
ALIGNMENT_TAIL_WINDOW_MIN_MARGIN_SECONDS = 15.0
ALIGNMENT_TAIL_WINDOW_MAX_MARGIN_SECONDS = 90.0
ALIGNMENT_TAIL_WINDOW_RETRY_MULTIPLIERS = (1.0, 2.0, 3.0)
ALIGNMENT_WINDOW_RETRY_LOOKBACK_SECONDS = (2.0, 15.0, 45.0)
ALIGNMENT_WINDOW_LOOKBACK_SECONDS = 2.0
ALIGNMENT_WINDOW_MAX_LOOKBACK_SECONDS = 120.0
ALIGNMENT_WIDE_LOOKBACK_GUARD_SECONDS = 600.0
ALIGNMENT_REMAINING_AUDIO_TOLERANCE = 0.55
ALIGNMENT_REMAINING_AUDIO_GUARD_SECONDS = 120.0
ALIGNMENT_MAX_GROUP_OVERLAP_SECONDS = 120.0


def split_text_into_chunks(text: str, max_chars: int) -> list[str]:
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

    return chunks if chunks else [text]


def split_oversized_chunk(text: str, max_chars: int) -> list[str]:
    stripped = text.strip()
    if len(stripped) <= max_chars:
        return [stripped]

    words = stripped.split()
    if not words:
        return [stripped]

    subchunks = []
    current_chunk = words[0]

    for word in words[1:]:
        candidate = f"{current_chunk} {word}"
        if len(candidate) <= max_chars:
            current_chunk = candidate
        else:
            subchunks.append(current_chunk)
            current_chunk = word

    if current_chunk:
        subchunks.append(current_chunk)

    return subchunks


def build_alignment_units(text: str, chunk_size: int) -> list[str]:
    generation_chunks = split_text_into_chunks(text, max_chars=chunk_size)
    raw_units = []

    for chunk in generation_chunks:
        raw_units.extend(split_oversized_chunk(chunk, max_chars=ALIGNMENT_GROUP_CHAR_LIMIT))

    grouped_units = []
    current_group = ""
    for unit in raw_units:
        if not current_group:
            current_group = unit
            continue

        merged = f"{current_group} {unit}".strip()
        if len(merged) <= ALIGNMENT_GROUP_CHAR_LIMIT:
            current_group = merged
        else:
            grouped_units.append(current_group)
            current_group = unit

    if current_group:
        grouped_units.append(current_group)

    return grouped_units


def split_alignment_unit(text: str) -> list[str]:
    words = text.split()
    if len(words) <= 1:
        return [text]

    midpoint = len(words) // 2
    left = " ".join(words[:midpoint]).strip()
    right = " ".join(words[midpoint:]).strip()
    return [part for part in (left, right) if part]


def read_audio_window(audio_file, start_sec: float, end_sec: float) -> np.ndarray:
    from scipy import signal

    sample_rate = int(audio_file.samplerate)
    start_frame = max(0, int(math.floor(start_sec * sample_rate)))
    end_frame = min(audio_file.frames, int(math.ceil(end_sec * sample_rate)))
    frame_count = max(0, end_frame - start_frame)

    if frame_count == 0:
        return np.array([], dtype=np.float32)

    audio_file.seek(start_frame)
    audio_data = audio_file.read(frame_count, dtype="float32", always_2d=True)
    if audio_data.shape[1] > 1:
        audio_data = audio_data.mean(axis=1)
    else:
        audio_data = audio_data[:, 0]

    if sample_rate != ALIGNMENT_SAMPLE_RATE and audio_data.size > 0:
        audio_data = signal.resample_poly(audio_data, ALIGNMENT_SAMPLE_RATE, sample_rate)

    return np.asarray(audio_data, dtype=np.float32)


def align_waveform_to_text(
    audio_waveform: torch.Tensor,
    text: str,
    language: str,
    batch_size: int,
    alignment_model,
    alignment_tokenizer,
) -> list[dict]:
    from ctc_forced_aligner import (
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )

    emissions, stride = generate_emissions(
        alignment_model,
        audio_waveform,
        batch_size=batch_size,
    )

    tokens_starred, text_starred = preprocess_text(
        text,
        romanize=True,
        language=language,
    )

    segments, scores, blank_token = get_alignments(
        emissions,
        tokens_starred,
        alignment_tokenizer,
    )

    spans = get_spans(tokens_starred, segments, blank_token)
    return postprocess_results(text_starred, spans, stride, scores)


def build_word_timings(
    word_timestamps: list[dict],
    original_text: str,
    char_offset: int,
    time_offset: float = 0.0,
) -> tuple[list[WordTiming], int]:
    result = []

    for item in word_timestamps:
        word = item["text"]
        start = item["start"] + time_offset
        end = item["end"] + time_offset

        word_clean = word.strip()
        if not word_clean:
            continue

        while char_offset < len(original_text) and original_text[char_offset].isspace():
            char_offset += 1

        char_start = char_offset
        char_end = char_start + len(word_clean)
        char_offset = char_end

        result.append(
            WordTiming(
                word=word_clean,
                start=start,
                end=end,
                char_start=char_start,
                char_end=char_end,
            )
        )

    return result, char_offset


def align_group_with_retries(
    audio_file,
    text: str,
    language: str,
    batch_size: int,
    audio_cursor_sec: float,
    total_duration: float,
    estimated_duration: float,
    group_index: int,
    group_count: int,
    alignment_model,
    alignment_tokenizer,
) -> tuple[list[dict], float]:
    remaining_audio = total_duration - audio_cursor_sec
    if remaining_audio <= ALIGNMENT_WIDE_LOOKBACK_GUARD_SECONDS:
        base_margin = min(
            ALIGNMENT_TAIL_WINDOW_MAX_MARGIN_SECONDS,
            max(ALIGNMENT_TAIL_WINDOW_MIN_MARGIN_SECONDS, estimated_duration * 0.5),
        )
        retry_multipliers = ALIGNMENT_TAIL_WINDOW_RETRY_MULTIPLIERS
    else:
        base_margin = min(
            ALIGNMENT_WINDOW_MAX_MARGIN_SECONDS,
            max(ALIGNMENT_WINDOW_MIN_MARGIN_SECONDS, estimated_duration * ALIGNMENT_WINDOW_MARGIN_RATIO),
        )
        retry_multipliers = ALIGNMENT_WINDOW_RETRY_MULTIPLIERS
    last_error = None

    for retry_index, retry_multiplier in enumerate(retry_multipliers):
        margin = base_margin * retry_multiplier
        if remaining_audio <= ALIGNMENT_WIDE_LOOKBACK_GUARD_SECONDS:
            lookback = min(
                ALIGNMENT_WINDOW_MAX_LOOKBACK_SECONDS,
                max(
                    ALIGNMENT_WINDOW_LOOKBACK_SECONDS,
                    retry_multiplier,
                    estimated_duration,
                    margin,
                ),
            )
        else:
            lookback = min(
                ALIGNMENT_WINDOW_MAX_LOOKBACK_SECONDS,
                ALIGNMENT_WINDOW_RETRY_LOOKBACK_SECONDS[
                    min(retry_index, len(ALIGNMENT_WINDOW_RETRY_LOOKBACK_SECONDS) - 1)
                ],
            )
        window_start = max(0.0, audio_cursor_sec - lookback)
        window_end = min(total_duration, audio_cursor_sec + estimated_duration + margin)

        try:
            audio_data = read_audio_window(audio_file, window_start, window_end)
            if audio_data.size == 0:
                raise ValueError(f"No audio available in window {window_start:.2f}-{window_end:.2f}s")

            audio_waveform = torch.from_numpy(audio_data).to(
                dtype=alignment_model.dtype,
                device=alignment_model.device,
            )
            word_timestamps = align_waveform_to_text(
                audio_waveform,
                text,
                language,
                batch_size,
                alignment_model,
                alignment_tokenizer,
            )
            if not word_timestamps:
                raise ValueError("Alignment returned no word timestamps")

            logger.info(
                "Aligned chunk group %s/%s using %.1fs-%.1fs window",
                group_index,
                group_count,
                window_start,
                window_end,
            )
            return word_timestamps, window_start
        except Exception as error:
            last_error = error
            logger.debug(
                "Chunk group %s/%s alignment retry failed with %.1fs margin: %s",
                group_index,
                group_count,
                margin,
                error,
            )

    if last_error is None:
        raise RuntimeError("Alignment retry loop failed without an error")
    raise last_error


def align_audio_to_text_in_chunks(
    audio_path: str,
    text: str,
    language: str,
    batch_size: int,
    chunk_size: int,
    total_duration: Optional[float],
    alignment_model,
    alignment_tokenizer,
) -> list[WordTiming]:
    import soundfile as sf

    alignment_units = build_alignment_units(text, chunk_size)
    result = []
    char_offset = 0
    audio_cursor_sec = 0.0
    consumed_chars = 0
    total_chars = sum(len(unit) for unit in alignment_units)

    with sf.SoundFile(audio_path) as audio_file:
        effective_duration = total_duration
        if effective_duration is None or effective_duration <= 0:
            effective_duration = audio_file.frames / audio_file.samplerate
        baseline_seconds_per_char = effective_duration / max(1, len(text))

        logger.info(
            "Using chunked alignment for %.1f-minute audio across %s alignment units",
            effective_duration / 60.0,
            len(alignment_units),
        )

        index = 0
        while index < len(alignment_units):
            group_text = alignment_units[index]
            remaining_chars = max(1, total_chars - consumed_chars)
            remaining_duration = max(1.0, effective_duration - audio_cursor_sec)
            if index == len(alignment_units) - 1:
                estimated_duration = remaining_duration
            else:
                estimated_duration = max(
                    ALIGNMENT_MIN_ESTIMATED_CHUNK_SECONDS,
                    remaining_duration * len(group_text) / remaining_chars,
                )

            try:
                word_timestamps, time_offset = align_group_with_retries(
                    audio_file=audio_file,
                    text=group_text,
                    language=language,
                    batch_size=batch_size,
                    audio_cursor_sec=audio_cursor_sec,
                    total_duration=effective_duration,
                    estimated_duration=estimated_duration,
                    group_index=index + 1,
                    group_count=len(alignment_units),
                    alignment_model=alignment_model,
                    alignment_tokenizer=alignment_tokenizer,
                )
            except Exception as error:
                split_units = split_alignment_unit(group_text)
                if len(split_units) > 1:
                    alignment_units[index:index + 1] = split_units
                    total_chars = sum(len(unit) for unit in alignment_units)
                    logger.debug(
                        "Splitting alignment unit %s/%s after failure for %s chars: %s",
                        index + 1,
                        len(alignment_units),
                        len(group_text),
                        error,
                    )
                    continue
                raise

            group_words, next_char_offset = build_word_timings(
                word_timestamps,
                text,
                char_offset,
                time_offset=time_offset,
            )
            if not group_words:
                raise ValueError(f"Chunk group {index} produced no aligned words")

            group_overlap = max(0.0, audio_cursor_sec - group_words[0].start)
            if group_overlap > ALIGNMENT_MAX_GROUP_OVERLAP_SECONDS:
                split_units = split_alignment_unit(group_text)
                if len(split_units) > 1:
                    alignment_units[index:index + 1] = split_units
                    total_chars = sum(len(unit) for unit in alignment_units)
                    logger.debug(
                        "Splitting alignment unit %s/%s after %.1fs overlap with the previous chunk",
                        index + 1,
                        len(alignment_units),
                        group_overlap,
                    )
                    continue
                raise ValueError(
                    f"Chunk group {index + 1} starts {group_overlap:.2f}s before the current cursor"
                )
            if group_overlap > 0:
                for word in group_words:
                    word.start += group_overlap
                    word.end += group_overlap

            for word in group_words:
                if word.start > effective_duration:
                    word.start = effective_duration
                if word.end > effective_duration:
                    word.end = effective_duration
                if word.end < word.start:
                    word.end = word.start

            next_cursor_sec = min(effective_duration, max(audio_cursor_sec, group_words[-1].end))
            remaining_text_chars = max(0, total_chars - (consumed_chars + len(group_text)))
            remaining_audio = max(0.0, effective_duration - next_cursor_sec)
            expected_remaining_audio = remaining_text_chars * baseline_seconds_per_char

            if (
                index < len(alignment_units) - 1
                and remaining_text_chars > 0
                and remaining_audio <= ALIGNMENT_REMAINING_AUDIO_GUARD_SECONDS
                and remaining_audio < expected_remaining_audio * ALIGNMENT_REMAINING_AUDIO_TOLERANCE
            ):
                split_units = split_alignment_unit(group_text)
                if len(split_units) > 1:
                    alignment_units[index:index + 1] = split_units
                    total_chars = sum(len(unit) for unit in alignment_units)
                    logger.debug(
                        "Splitting alignment unit %s/%s after remaining-audio overshoot: %.1fs left for %.1fs expected (%s chars remaining)",
                        index + 1,
                        len(alignment_units),
                        remaining_audio,
                        expected_remaining_audio,
                        remaining_text_chars,
                    )
                    continue

            char_offset = next_char_offset
            audio_cursor_sec = next_cursor_sec
            consumed_chars += len(group_text)
            result.extend(group_words)
            index += 1

    return stabilize_word_timings(result)