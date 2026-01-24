export interface HistoryItem {
    id: string
    text: string
    voice: string
    speed: number
    filename: string
    duration?: number
    timestamp: number
    url: string
    model?: string  // TTS engine used: "kokoro", "qwen3-0.6B", "qwen3-1.7B"
}

export interface WordTiming {
    word: string
    start: number
    end: number
    charStart: number
    charEnd: number
}

export interface AlignmentData {
    words: WordTiming[]
    cached: boolean
}
