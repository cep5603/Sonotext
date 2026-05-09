"""Shared types for alignment backends."""

from dataclasses import dataclass


@dataclass
class WordTiming:
    """Timing information for a single word."""

    word: str
    start: float
    end: float
    char_start: int
    char_end: int


def stabilize_word_timings(words: list[WordTiming]) -> list[WordTiming]:
    previous_end = 0.0

    for word in words:
        if word.start < previous_end:
            word.start = previous_end
        if word.end < word.start:
            word.end = word.start
        previous_end = word.end

    return words