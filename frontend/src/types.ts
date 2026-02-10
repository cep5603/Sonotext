export interface HistoryItem {
    id: string
    text: string
    voice: string
    speed: number
    filename: string
    duration?: number
    timestamp: number
    url: string
    model?: string  // TTS engine used: "kokoro", "qwen3-1.7B"
    voice_profile_id?: string | null  // Track custom voice profile for rename sync
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

export interface VoiceProfile {
    id: string
    name: string
    description: string
    reference_text: string
    language: string
    source: "designed" | "uploaded"
    created_at: number
}

export interface Project {
    id: string
    name: string
    generation_ids: string[]
    created_at: number
    generations: HistoryItem[]  // resolved from backend
}
