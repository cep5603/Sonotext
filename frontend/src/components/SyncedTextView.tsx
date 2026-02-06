import { useRef, useEffect, useCallback, useMemo } from "react"
import type { WordTiming } from "@/types"
import { cn } from "@/lib/utils"

interface SyncedTextViewProps {
    text: string
    alignmentData: WordTiming[] | null
    currentTime: number
    onSeek: (time: number) => void
    isPlaying: boolean
    autoScroll: boolean
}

/**
 * Find the current word index based on playback time.
 * Returns the most recent (highest index) word whose start time has passed.
 * Keeps word highlighted until the next word starts (no gaps).
 */
function findCurrentWordIndex(words: WordTiming[], time: number): number {
    if (words.length === 0) return -1

    // Before the first word starts
    if (time < words[0].start) return -1

    // Find the last word whose start time is <= current time
    let left = 0
    let right = words.length - 1
    let result = 0

    while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        if (words[mid].start <= time) {
            result = mid
            left = mid + 1  // Keep looking for later words
        } else {
            right = mid - 1
        }
    }

    return result
}

export function SyncedTextView({
    text,
    alignmentData,
    currentTime,
    onSeek,
    isPlaying,
    autoScroll
}: SyncedTextViewProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const activeWordRef = useRef<HTMLSpanElement>(null)
    const lastScrolledIndex = useRef(-1)

    // Find the currently active word (only when playing)
    const currentWordIndex = useMemo(() => {
        if (!alignmentData || !isPlaying) return -1
        return findCurrentWordIndex(alignmentData, currentTime)
    }, [alignmentData, currentTime, isPlaying])

    // Auto-scroll to keep the active word in view
    useEffect(() => {
        if (!autoScroll || !isPlaying) return
        if (currentWordIndex === lastScrolledIndex.current) return
        if (!activeWordRef.current) return

        lastScrolledIndex.current = currentWordIndex

        activeWordRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest"
        })
    }, [currentWordIndex, autoScroll, isPlaying])

    // Reset scroll tracking when audio restarts
    useEffect(() => {
        if (currentTime < 0.5) {
            lastScrolledIndex.current = -1
        }
    }, [currentTime])

    const handleWordClick = useCallback((word: WordTiming) => {
        onSeek(word.start)
    }, [onSeek])

    // If no alignment data, render plain text (fallback)
    if (!alignmentData || alignmentData.length === 0) {
        return (
            <div
                ref={containerRef}
                className="flex-1 min-h-0 rounded-lg border bg-muted/30 overflow-y-auto p-4"
            >
                <p className="text-base leading-relaxed whitespace-pre-wrap">
                    {text}
                </p>
            </div>
        )
    }

    // Render text with clickable, highlightable word spans
    return (
        <div
            ref={containerRef}
            className="flex-1 min-h-0 rounded-lg border bg-muted/30 overflow-y-auto p-4"
        >
            <p className="text-base leading-relaxed whitespace-pre-wrap">
                {alignmentData.map((word, index) => {
                    const isActive = index === currentWordIndex

                    // Preserve whitespace between words from the original text
                    const nextWord = alignmentData[index + 1]
                    let separator = " "
                    if (nextWord) {
                        const textBetween = text.slice(word.charEnd, nextWord.charStart)
                        // Use the original whitespace if it contains newlines
                        if (textBetween.includes("\n")) {
                            separator = textBetween
                        }
                    }

                    return (
                        <span key={`${word.charStart}-${index}`}>
                            <span
                                ref={isActive ? activeWordRef : null}
                                onClick={() => handleWordClick(word)}
                                className={cn(
                                    "synced-text-word cursor-pointer rounded px-0.5",
                                    "hover:bg-primary/10",
                                    isActive && "bg-primary/30"
                                )}
                            >
                                {word.word}
                            </span>
                            {/* Add appropriate separator (space or newline) */}
                            {index < alignmentData.length - 1 && separator}
                        </span>
                    )
                })}
            </p>
        </div>
    )
}
