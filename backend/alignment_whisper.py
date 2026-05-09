"""Whisper-backed long-audio alignment helpers."""

import logging
import re
from typing import Optional

import torch

from alignment_types import WordTiming, stabilize_word_timings
from language_utils import map_language_to_whisper_language

logger = logging.getLogger("AlignmentService")

WHISPER_LONG_ALIGNMENT_MODEL = "small"
WHISPER_MATCH_LOOKAHEAD = 12
WHISPER_MATCH_MIN_RUN = 2
WHISPER_MIN_ANCHOR_WORD_LENGTH = 3
WHISPER_MIN_ASR_MATCH_RATIO = 0.75


def normalize_alignment_token(word: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", word.lower())


def extract_target_word_entries(text: str) -> list[dict]:
    words = []
    for match in re.finditer(r"\S+", text):
        raw_word = match.group(0)
        normalized = normalize_alignment_token(raw_word)
        if not normalized:
            continue
        words.append(
            {
                "word": raw_word,
                "norm": normalized,
                "char_start": match.start(),
                "char_end": match.end(),
            }
        )
    return words


def get_audio_duration_seconds(audio_path: str) -> float:
    import soundfile as sf

    with sf.SoundFile(audio_path) as audio_file:
        return audio_file.frames / audio_file.samplerate


def transcribe_audio_words_with_whisper(audio_path: str, language: str) -> list[dict]:
    from faster_whisper import WhisperModel

    whisper_language = map_language_to_whisper_language(language)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    logger.info("Transcribing long audio with faster-whisper (%s)", WHISPER_LONG_ALIGNMENT_MODEL)
    model = WhisperModel(WHISPER_LONG_ALIGNMENT_MODEL, device=device, compute_type=compute_type)

    try:
        segments, _info = model.transcribe(
            audio_path,
            language=whisper_language,
            word_timestamps=True,
        )

        words = []
        for segment in segments:
            for word in segment.words or []:
                raw_word = (word.word or "").strip()
                normalized = normalize_alignment_token(raw_word)
                if not normalized:
                    continue
                words.append(
                    {
                        "word": raw_word,
                        "norm": normalized,
                        "start": float(word.start),
                        "end": float(word.end),
                    }
                )
        return words
    finally:
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def match_target_words_to_whisper_words(target_words: list[dict], whisper_words: list[dict]) -> list[tuple[int, int]]:
    matches: list[tuple[int, int]] = []
    target_index = 0
    whisper_index = 0

    while target_index < len(target_words) and whisper_index < len(whisper_words):
        if target_words[target_index]["norm"] == whisper_words[whisper_index]["norm"]:
            matches.append((target_index, whisper_index))
            target_index += 1
            whisper_index += 1
            continue

        best_match = None
        for target_skip in range(WHISPER_MATCH_LOOKAHEAD):
            candidate_target = target_index + target_skip
            if candidate_target >= len(target_words):
                break
            if len(target_words[candidate_target]["norm"]) < WHISPER_MIN_ANCHOR_WORD_LENGTH:
                continue

            for whisper_skip in range(WHISPER_MATCH_LOOKAHEAD):
                candidate_whisper = whisper_index + whisper_skip
                if candidate_whisper >= len(whisper_words):
                    break
                if target_words[candidate_target]["norm"] != whisper_words[candidate_whisper]["norm"]:
                    continue

                run_length = 0
                while (
                    candidate_target + run_length < len(target_words)
                    and candidate_whisper + run_length < len(whisper_words)
                    and target_words[candidate_target + run_length]["norm"]
                    == whisper_words[candidate_whisper + run_length]["norm"]
                    and run_length < WHISPER_MATCH_LOOKAHEAD
                ):
                    run_length += 1

                if run_length < WHISPER_MATCH_MIN_RUN:
                    continue

                candidate = (target_skip + whisper_skip, -run_length, target_skip, whisper_skip)
                if best_match is None or candidate < best_match:
                    best_match = candidate
                break

        if best_match is None:
            whisper_index += 1
            continue

        target_index += best_match[2]
        whisper_index += best_match[3]

    return matches


def fill_interpolated_timings(
    target_words: list[dict],
    aligned_times: list[Optional[tuple[float, float]]],
    total_duration: float,
) -> None:
    matched_positions = [index for index, timing in enumerate(aligned_times) if timing is not None]
    if not matched_positions:
        raise ValueError("No transcript words could be matched to Whisper timestamps")

    first_match = matched_positions[0]
    if first_match > 0:
        prefix_duration = max(0.01, aligned_times[first_match][0])
        prefix_weights = [max(1, len(target_words[index]["norm"])) for index in range(first_match)]
        prefix_weight_sum = max(1, sum(prefix_weights))
        cursor = 0.0
        for index, weight in enumerate(prefix_weights):
            duration = prefix_duration * weight / prefix_weight_sum
            aligned_times[index] = (cursor, cursor + duration)
            cursor += duration

    for left_match, right_match in zip(matched_positions, matched_positions[1:]):
        if right_match - left_match <= 1:
            continue

        gap_start = aligned_times[left_match][1]
        gap_end = aligned_times[right_match][0]
        gap_duration = max(0.01, gap_end - gap_start)
        gap_indices = range(left_match + 1, right_match)
        gap_weights = [max(1, len(target_words[index]["norm"])) for index in gap_indices]
        gap_weight_sum = max(1, sum(gap_weights))
        cursor = gap_start

        for index, weight in zip(gap_indices, gap_weights):
            duration = gap_duration * weight / gap_weight_sum
            aligned_times[index] = (cursor, cursor + duration)
            cursor += duration

    last_match = matched_positions[-1]
    if last_match < len(target_words) - 1:
        suffix_start = aligned_times[last_match][1]
        suffix_duration = max(0.01, total_duration - suffix_start)
        suffix_indices = range(last_match + 1, len(target_words))
        suffix_weights = [max(1, len(target_words[index]["norm"])) for index in suffix_indices]
        suffix_weight_sum = max(1, sum(suffix_weights))
        cursor = suffix_start

        for index, weight in zip(suffix_indices, suffix_weights):
            duration = suffix_duration * weight / suffix_weight_sum
            aligned_times[index] = (cursor, cursor + duration)
            cursor += duration


def align_long_audio_with_whisper(
    audio_path: str,
    text: str,
    language: str,
    total_duration: Optional[float],
) -> list[WordTiming]:
    target_words = extract_target_word_entries(text)
    whisper_words = transcribe_audio_words_with_whisper(audio_path, language)
    matches = match_target_words_to_whisper_words(target_words, whisper_words)

    if not whisper_words:
        raise ValueError("Whisper transcription returned no words")
    if len(matches) / len(whisper_words) < WHISPER_MIN_ASR_MATCH_RATIO:
        raise ValueError(
            f"Whisper alignment matched only {len(matches)}/{len(whisper_words)} ASR words"
        )

    effective_duration = total_duration or get_audio_duration_seconds(audio_path)
    aligned_times: list[Optional[tuple[float, float]]] = [None] * len(target_words)
    for target_index, whisper_index in matches:
        whisper_word = whisper_words[whisper_index]
        aligned_times[target_index] = (whisper_word["start"], whisper_word["end"])

    fill_interpolated_timings(target_words, aligned_times, effective_duration)

    result = []
    for target_word, timing in zip(target_words, aligned_times):
        start, end = timing
        result.append(
            WordTiming(
                word=target_word["word"],
                start=start,
                end=max(start, end),
                char_start=target_word["char_start"],
                char_end=target_word["char_end"],
            )
        )

    logger.info(
        "Using Whisper-based long alignment with %s matched words out of %s transcript words and %s ASR words",
        len(matches),
        len(target_words),
        len(whisper_words),
    )
    return stabilize_word_timings(result)