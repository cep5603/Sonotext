import { useQuery } from "@tanstack/react-query"
import axios from "axios"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface VoiceSelectorProps {
    value: string
    onValueChange: (value: string) => void
}

export function VoiceSelector({ value, onValueChange }: VoiceSelectorProps) {
    const { data: voices, isLoading } = useQuery({
        queryKey: ["voices"],
        queryFn: async () => {
            // In local dev we assume backend is at :8000
            const res = await axios.get("http://localhost:8000/api/voices")
            return res.data as string[]
        },
    })

    return (
        <Select value={value} onValueChange={onValueChange}>
            <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={isLoading ? "Loading..." : "Select voice"} />
            </SelectTrigger>
            <SelectContent>
                {voices?.map((voice) => (
                    <SelectItem key={voice} value={voice}>
                        {voice}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
