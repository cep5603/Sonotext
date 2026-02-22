import { useRef, useEffect, useCallback, useMemo, memo } from "react"
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

// Memoized word span — only re-renders when isActive or the word itself changes
interface WordSpanProps {
    word: WordTiming
    separator: string
    isLast: boolean
    isActive: boolean
    activeWordRef: React.RefObject<HTMLSpanElement | null>
    onSeek: (time: number) => void
}

const WordSpan = memo(function WordSpan({
    word,
    separator,
    isLast,
    isActive,
    activeWordRef,
    onSeek,
}: WordSpanProps) {
    return (
        <span>
            <span
                ref={isActive ? activeWordRef : null}
                onClick={() => onSeek(word.start)}
                className={cn(
                    "synced-text-word cursor-pointer rounded px-0.5",
                    "hover:bg-primary/10",
                    isActive && "bg-primary/30"
                )}
            >
                {word.word}
            </span>
            {/* Add appropriate separator (space or newline) */}
            {!isLast && separator}
        </span>
    )
})

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
    const scrollThrottleRef = useRef(false)
    const scrollThrottleTimeoutRef = useRef<number | null>(null)

    // Pre-compute separators once when alignment data or text changes
    const separators = useMemo(() => {
        if (!alignmentData) return []
        return alignmentData.map((word, index) => {
            const nextWord = alignmentData[index + 1]
            if (!nextWord) return ""

            const safeStart = Math.max(0, Math.min(text.length, word.charEnd))
            const safeEnd = Math.max(safeStart, Math.min(text.length, nextWord.charStart))
            const textBetween = text.slice(safeStart, safeEnd)

            // Use the original whitespace if it contains newlines
            if (textBetween.includes("\n")) {
                return textBetween
            }
            return " "
        })
    }, [alignmentData, text])

    // Find the currently active word (only when playing)
    const currentWordIndex = useMemo(() => {
        if (!alignmentData || !isPlaying) return -1
        return findCurrentWordIndex(alignmentData, currentTime)
    }, [alignmentData, currentTime, isPlaying])

    // Auto-scroll to keep the active word in view (throttled)
    useEffect(() => {
        if (!autoScroll || !isPlaying) return
        if (currentWordIndex < 0) return
        if (currentWordIndex === lastScrolledIndex.current) return
        if (!activeWordRef.current) return
        if (scrollThrottleRef.current) return

        lastScrolledIndex.current = currentWordIndex
        scrollThrottleRef.current = true

        activeWordRef.current.scrollIntoView({
            behavior: "auto",
            block: "center",
            inline: "nearest"
        })

        // Throttle scroll to at most once per 300ms to avoid piling up animations
        if (scrollThrottleTimeoutRef.current !== null) {
            window.clearTimeout(scrollThrottleTimeoutRef.current)
        }
        scrollThrottleTimeoutRef.current = window.setTimeout(() => {
            scrollThrottleRef.current = false
            scrollThrottleTimeoutRef.current = null
        }, 300)
    }, [currentWordIndex, autoScroll, isPlaying])

    useEffect(() => {
        return () => {
            if (scrollThrottleTimeoutRef.current !== null) {
                window.clearTimeout(scrollThrottleTimeoutRef.current)
            }
        }
    }, [])

    // Reset scroll tracking when audio restarts
    useEffect(() => {
        if (currentTime < 0.5) {
            lastScrolledIndex.current = -1
        }
    }, [currentTime])

    const handleWordSeek = useCallback((time: number) => {
        onSeek(time)
    }, [onSeek])

    // If no alignment data, render plain text (fallback)
    if (!alignmentData || alignmentData.length === 0) {
        return (
            <div
                ref={containerRef}
                className="flex-1 min-h-0 rounded-lg border bg-card/30 overflow-y-auto p-4"
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
            className="flex-1 min-h-0 rounded-lg border bg-card/30 overflow-y-auto p-4"
        >
            <p className="text-base leading-relaxed whitespace-pre-wrap">
                {alignmentData.map((word, index) => (
                    <WordSpan
                        key={`${word.charStart}-${index}`}
                        word={word}
                        separator={separators[index]}
                        isLast={index === alignmentData.length - 1}
                        isActive={index === currentWordIndex}
                        activeWordRef={activeWordRef}
                        onSeek={handleWordSeek}
                    />
                ))}
            </p>
        </div>
    )
}
