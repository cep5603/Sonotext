import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2, Power, Circle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { VoiceSelector } from "./VoiceSelector"
import { LLMModelSelector } from "./LLMModelSelector"
import { cn } from "@/lib/utils"

interface SettingsSidebarProps {
    voice: string
    onVoiceChange: (voice: string) => void
    lang: string | null
    onLangChange: (lang: string | null) => void
    speed: number[]
    onSpeedChange: (speed: number[]) => void
}

const LANGUAGE_OPTIONS = [
    { value: "auto", label: "Auto (from voice)" },
    { value: "en-us", label: "English (US)" },
    { value: "en-gb", label: "English (UK)" },
    { value: "es", label: "Spanish" },
    { value: "fr-fr", label: "French" },
    { value: "hi", label: "Hindi" },
    { value: "it", label: "Italian" },
    { value: "pt-br", label: "Portuguese (BR)" },
]

interface PrecisionOption {
    id: string
    filename: string
    size: string
    gpu: boolean
    downloaded: boolean
    active: boolean
}

export function SettingsSidebar({
    voice,
    onVoiceChange,
    lang,
    onLangChange,
    speed,
    onSpeedChange,
}: SettingsSidebarProps) {
    const queryClient = useQueryClient()

    // Model precision state
    const { data: precisionData } = useQuery({
        queryKey: ["model-precision"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/model-precision")
            return res.data as { options: PrecisionOption[]; current: string }
        },
    })

    const setPrecisionMutation = useMutation({
        mutationFn: async (precision: string) => {
            await axios.post("http://localhost:8000/api/model-precision", { precision })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["model-precision"] })
            queryClient.invalidateQueries({ queryKey: ["voices"] })
        },
    })

    // LLM model status
    const { data: modelStatus } = useQuery({
        queryKey: ["llm-model-status"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/llm-model-status")
            return res.data as { model: string; status: string }
        },
        refetchInterval: 5000,
    })

    const unloadMutation = useMutation({
        mutationFn: async () => {
            await axios.post("http://localhost:8000/api/llm-unload")
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["llm-model-status"] })
            queryClient.invalidateQueries({ queryKey: ["llm-models"] })
        },
    })

    const status = modelStatus?.status ?? "not-loaded"

    const statusColor = {
        "loaded": "text-green-500",
        "loading": "text-yellow-500",
        "not-loaded": "text-muted-foreground",
    }[status] ?? "text-muted-foreground"

    const statusLabel = {
        "loaded": "Loaded",
        "loading": "Loading...",
        "not-loaded": "Not Loaded",
    }[status] ?? "Unknown"

    return (
        <div className="w-64 border-r border-border bg-card/50 backdrop-blur-sm h-full flex flex-col shrink-0">
            <div className="p-4 border-b border-border shrink-0">
                <h2 className="font-semibold tracking-tight">Settings</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Voice Synthesis Settings */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Voice</Label>
                        <VoiceSelector value={voice} onValueChange={onVoiceChange} />
                    </div>

                    <div className="space-y-2">
                        <Label>Language</Label>
                        <Select
                            value={lang ?? "auto"}
                            onValueChange={(v) => onLangChange(v === "auto" ? null : v)}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select language" />
                            </SelectTrigger>
                            <SelectContent>
                                {LANGUAGE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Speed</Label>
                            <span className="text-sm text-muted-foreground">{speed[0]}x</span>
                        </div>
                        <Slider
                            value={speed}
                            onValueChange={onSpeedChange}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Model Precision</Label>
                        <Select
                            value={precisionData?.current ?? "fp32"}
                            onValueChange={(value) => setPrecisionMutation.mutate(value)}
                            disabled={setPrecisionMutation.isPending}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select precision" />
                            </SelectTrigger>
                            <SelectContent>
                                {precisionData?.options.map((opt) => (
                                    <SelectItem key={opt.id} value={opt.id}>
                                        <div className="flex items-center gap-2">
                                            <span className="uppercase font-medium">{opt.id}</span>
                                            <span className="text-xs text-muted-foreground">
                                                ({opt.size})
                                            </span>
                                            {opt.gpu && (
                                                <span className="text-xs text-green-500">GPU</span>
                                            )}
                                            {!opt.downloaded && (
                                                <span className="text-xs text-yellow-500">⬇</span>
                                            )}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {setPrecisionMutation.isPending && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Loading model...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Separator */}
                <div className="border-t border-border" />

                {/* Text Processing Settings */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Text Model</Label>
                        <LLMModelSelector />
                    </div>

                    {/* Model Status Indicator */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                            {status === "loading" ? (
                                <Loader2 className={cn("h-3 w-3 animate-spin", statusColor)} />
                            ) : (
                                <Circle className={cn("h-3 w-3 fill-current", statusColor)} />
                            )}
                            <span className={statusColor}>{statusLabel}</span>
                        </div>
                        {status === "loaded" && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => unloadMutation.mutate()}
                                disabled={unloadMutation.isPending}
                            >
                                {unloadMutation.isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <>
                                        <Power className="h-3 w-3 mr-1" />
                                        Eject
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
