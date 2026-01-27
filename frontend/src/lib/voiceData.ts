// Voice metadata derived from Kokoro-82M model card
// Sorted by grade within each language (best first)

export interface Voice {
    id: string
    name: string
    gender: "F" | "M"
    grade: string
    gradeOrder: number // Lower = better (A=1, A-=2, B+=3, B=4, B-=5, C+=6, C=7, C-=8, D+=9, D=10, D-=11, F+=12, F=13)
}

export interface LanguageGroup {
    code: string
    label: string
    flag: string
    voices: Voice[]
}

// Grade ordering for sorting (lower = better)
const GRADE_ORDER: Record<string, number> = {
    "A": 1, "A-": 2,
    "B+": 3, "B": 4, "B-": 5,
    "C+": 6, "C": 7, "C-": 8,
    "D+": 9, "D": 10, "D-": 11,
    "F+": 12, "F": 13,
    "?": 99, // Unknown grade
}

function parseGrade(grade: string): number {
    return GRADE_ORDER[grade] ?? 99
}

function sortByGrade(voices: Voice[]): Voice[] {
    return [...voices].sort((a, b) => a.gradeOrder - b.gradeOrder)
}

// Helper to create voice entries
function v(id: string, gender: "F" | "M", grade: string): Voice {
    // Extract name from id (e.g., "af_heart" -> "Heart")
    const rawName = id.split("_").slice(1).join("_")
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    return { id, name, gender, grade, gradeOrder: parseGrade(grade) }
}

export const VOICE_DATA: LanguageGroup[] = [
    {
        code: "american",
        label: "American English",
        flag: "🇺🇸",
        voices: sortByGrade([
            v("af_heart", "F", "A"),
            v("af_bella", "F", "A-"),
            v("af_nicole", "F", "B-"),
            v("af_aoede", "F", "C+"),
            v("af_kore", "F", "C+"),
            v("af_sarah", "F", "C+"),
            v("am_fenrir", "M", "C+"),
            v("am_michael", "M", "C+"),
            v("am_puck", "M", "C+"),
            v("af_alloy", "F", "C"),
            v("af_nova", "F", "C"),
            v("af_sky", "F", "C-"),
            v("af_jessica", "F", "D"),
            v("af_river", "F", "D"),
            v("am_echo", "M", "D"),
            v("am_eric", "M", "D"),
            v("am_liam", "M", "D"),
            v("am_onyx", "M", "D"),
            v("am_santa", "M", "D-"),
            v("am_adam", "M", "F+"),
        ]),
    },
    {
        code: "british",
        label: "British English",
        flag: "🇬🇧",
        voices: sortByGrade([
            v("bf_emma", "F", "B-"),
            v("bf_isabella", "F", "C"),
            v("bm_fable", "M", "C"),
            v("bm_george", "M", "C"),
            v("bf_alice", "F", "D"),
            v("bf_lily", "F", "D"),
            v("bm_daniel", "M", "D"),
            v("bm_lewis", "M", "D+"),
        ]),
    },
    {
        code: "japanese",
        label: "Japanese",
        flag: "🇯🇵",
        voices: sortByGrade([
            v("jf_alpha", "F", "C+"),
            v("jf_gongitsune", "F", "C"),
            v("jf_tebukuro", "F", "C"),
            v("jf_nezumi", "F", "C-"),
            v("jm_kumo", "M", "C-"),
        ]),
    },
    {
        code: "mandarin",
        label: "Mandarin Chinese",
        flag: "🇨🇳",
        voices: sortByGrade([
            v("zf_xiaobei", "F", "D"),
            v("zf_xiaoni", "F", "D"),
            v("zf_xiaoxiao", "F", "D"),
            v("zf_xiaoyi", "F", "D"),
            v("zm_yunjian", "M", "D"),
            v("zm_yunxi", "M", "D"),
            v("zm_yunxia", "M", "D"),
            v("zm_yunyang", "M", "D"),
        ]),
    },
    {
        code: "spanish",
        label: "Spanish",
        flag: "🇪🇸",
        voices: sortByGrade([
            v("ef_dora", "F", "?"),
            v("em_alex", "M", "?"),
            v("em_santa", "M", "?"),
        ]),
    },
    {
        code: "french",
        label: "French",
        flag: "🇫🇷",
        voices: sortByGrade([
            v("ff_siwis", "F", "B-"),
        ]),
    },
    {
        code: "hindi",
        label: "Hindi",
        flag: "🇮🇳",
        voices: sortByGrade([
            v("hf_alpha", "F", "C"),
            v("hf_beta", "F", "C"),
            v("hm_omega", "M", "C"),
            v("hm_psi", "M", "C"),
        ]),
    },
    {
        code: "italian",
        label: "Italian",
        flag: "🇮🇹",
        voices: sortByGrade([
            v("if_sara", "F", "C"),
            v("im_nicola", "M", "C"),
        ]),
    },
    {
        code: "portuguese",
        label: "Brazilian Portuguese",
        flag: "🇧🇷",
        voices: sortByGrade([
            v("pf_dora", "F", "?"),
            v("pm_alex", "M", "?"),
            v("pm_santa", "M", "?"),
        ]),
    },
    // Qwen3-TTS voices (multi-lingual, categorized by primary language)
    {
        code: "qwen3-english",
        label: "Qwen3 English",
        flag: "🌐",
        voices: [
            { id: "aiden", name: "Aiden", gender: "M", grade: "-", gradeOrder: 0 },
            { id: "dylan", name: "Dylan", gender: "M", grade: "-", gradeOrder: 0 },
            { id: "eric", name: "Eric", gender: "M", grade: "-", gradeOrder: 0 },
            { id: "ryan", name: "Ryan", gender: "M", grade: "-", gradeOrder: 0 },
            { id: "serena", name: "Serena", gender: "F", grade: "-", gradeOrder: 0 },
        ],
    },
    {
        code: "qwen3-chinese",
        label: "Qwen3 Chinese",
        flag: "🇨🇳",
        voices: [
            { id: "vivian", name: "Vivian", gender: "F", grade: "-", gradeOrder: 0 },
            { id: "uncle_fu", name: "Uncle Fu", gender: "M", grade: "-", gradeOrder: 0 },
        ],
    },
    {
        code: "qwen3-japanese",
        label: "Qwen3 Japanese",
        flag: "🇯🇵",
        voices: [
            { id: "ono_anna", name: "Ono Anna", gender: "F", grade: "-", gradeOrder: 0 },
        ],
    },
    {
        code: "qwen3-korean",
        label: "Qwen3 Korean",
        flag: "🇰🇷",
        voices: [
            { id: "sohee", name: "Sohee", gender: "F", grade: "-", gradeOrder: 0 },
        ],
    },
]

// Lookup map for quick access by voice ID
export const VOICE_MAP = new Map<string, { voice: Voice; language: LanguageGroup }>()
for (const lang of VOICE_DATA) {
    for (const voice of lang.voices) {
        VOICE_MAP.set(voice.id, { voice, language: lang })
    }
}

// Get language group for a voice ID
export function getVoiceLanguage(voiceId: string): LanguageGroup | undefined {
    return VOICE_MAP.get(voiceId)?.language
}

// Get voice info for a voice ID  
export function getVoiceInfo(voiceId: string): Voice | undefined {
    return VOICE_MAP.get(voiceId)?.voice
}
