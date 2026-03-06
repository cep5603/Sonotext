import { useQuery } from "@tanstack/react-query"
import axios from "axios"
import { MicrophoneIcon, PaletteIcon } from "@phosphor-icons/react"
import type { VoiceProfile } from "@/types"

/**
 * Renders PaletteIcon for designed voices, MicrophoneIcon for cloned voices.
 * Returns null if no voiceProfileId is provided.
 */
export function VoiceSourceIcon({
    voiceProfileId,
    size = 14,
}: {
    voiceProfileId?: string | null
    size?: number
}) {
    const { data: profiles } = useQuery({
        queryKey: ["voice-profiles"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/voice-profiles")
            return res.data.profiles as VoiceProfile[]
        },
        staleTime: 30_000,
    })

    if (!voiceProfileId) return null

    const source = profiles?.find((p) => p.id === voiceProfileId)?.source

    return source === "designed" ? (
        <PaletteIcon size={size} className="shrink-0 text-purple-500" />
    ) : (
        <MicrophoneIcon size={size} className="shrink-0 text-blue-500" />
    )
}
