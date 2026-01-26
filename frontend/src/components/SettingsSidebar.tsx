import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2, Power, Circle, RefreshCw, Zap, Sparkles } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface SettingsSidebarProps {
    voice: string
    onVoiceChange: (voice: string) => void
    lang: string | null
    onLangChange: (lang: string | null) => void
    speed: number[]
    onSpeedChange: (speed: number[]) => void
    engine: "kokoro" | "qwen3"
    onEngineChange: (engine: "kokoro" | "qwen3") => void
    instruct: string
    onInstructChange: (instruct: string) => void
}

const KOKORO_LANGUAGE_OPTIONS = [
    { value: "auto", label: "Auto (from voice)" },
    { value: "en-us", label: "English (US)" },
    { value: "en-gb", label: "English (UK)" },
    { value: "es", label: "Spanish" },
    { value: "fr-fr", label: "French" },
    { value: "hi", label: "Hindi" },
    { value: "it", label: "Italian" },
    { value: "pt-br", label: "Portuguese (BR)" },
]

const QWEN3_LANGUAGE_OPTIONS = [
    { value: "auto", label: "Auto (detect)" },
    { value: "english", label: "English" },
    { value: "chinese", label: "Chinese" },
    { value: "japanese", label: "Japanese" },
    { value: "korean", label: "Korean" },
    { value: "french", label: "French" },
    { value: "german", label: "German" },
    { value: "italian", label: "Italian" },
    { value: "spanish", label: "Spanish" },
    { value: "portuguese", label: "Portuguese" },
    { value: "russian", label: "Russian" },
]

// Qwen3-TTS Model Status Component
function Qwen3ModelStatus() {
    const queryClient = useQueryClient()

    const { data: modelInfo, isLoading } = useQuery({
        queryKey: ["qwen3-info"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/qwen3/info")
            return res.data as {
                loaded: boolean
                model_id: string | null
                model_size: string | null
                flash_attention: boolean | null
            }
        },
        refetchInterval: 3000,
    })

    const loadMutation = useMutation({
        mutationFn: async (modelSize: string) => {
            await axios.post("http://localhost:8000/api/qwen3/load", { model_size: modelSize })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["qwen3-info"] })
        },
    })

    const unloadMutation = useMutation({
        mutationFn: async () => {
            await axios.post("http://localhost:8000/api/qwen3/unload")
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["qwen3-info"] })
        },
    })

    const isModelLoaded = modelInfo?.loaded ?? false

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                    <Circle className={cn(
                        "h-2.5 w-2.5 fill-current",
                        isModelLoaded ? "text-green-500" : "text-muted-foreground"
                    )} />
                    <span className={isModelLoaded ? "text-foreground" : "text-muted-foreground"}>
                        {isModelLoaded
                            ? `${modelInfo?.model_size} Model Loaded`
                            : "Model Not Loaded"}
                    </span>
                </div>
                {isModelLoaded && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => unloadMutation.mutate()}
                        disabled={unloadMutation.isPending}
                    >
                        {unloadMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <>
                                <Power className="h-3 w-3 mr-1" />
                                Unload
                            </>
                        )}
                    </Button>
                )}
            </div>
            {!isModelLoaded && (
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => loadMutation.mutate("1.7B")}
                        disabled={loadMutation.isPending}
                    >
                        {loadMutation.isPending ? (
                            <>
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                Loading...
                            </>
                        ) : (
                            "Load 1.7B Model"
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => loadMutation.mutate("0.6B")}
                        disabled={loadMutation.isPending}
                    >
                        0.6B
                    </Button>
                </div>
            )}
            {!modelInfo?.flash_attention && isModelLoaded && (
                <p className="text-xs text-amber-500">
                    ⚠ FlashAttention not available
                </p>
            )}
        </div>
    )
}

export function SettingsSidebar({
    voice,
    onVoiceChange,
    lang,
    onLangChange,
    speed,
    onSpeedChange,
    engine,
    onEngineChange,
    instruct,
    onInstructChange,
}: SettingsSidebarProps) {
    const queryClient = useQueryClient()

    // LLM status
    const { data: modelStatus } = useQuery({
        queryKey: ["llm-model-status"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/llm-model-status")
            return res.data as { model: string; status: string }
        },
        refetchInterval: 5000,
        staleTime: 0,
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
                    {/* TTS Engine Selector */}
                    <div className="space-y-2">
                        <Label>TTS Engine</Label>
                        <Select
                            value={engine}
                            onValueChange={(v) => onEngineChange(v as "kokoro" | "qwen3")}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="kokoro">
                                    <div className="flex items-center gap-2">
                                        <Zap className="h-3.5 w-3.5 text-yellow-500" />
                                        <span>Kokoro</span>
                                        <span className="text-xs text-muted-foreground">(Fast)</span>
                                    </div>
                                </SelectItem>
                                <SelectItem value="qwen3">
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                                        <span>Qwen3-TTS</span>
                                        <span className="text-xs text-muted-foreground">(Expressive)</span>
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Voice selector - only show for Kokoro engine */}
                    {engine === "kokoro" && (
                        <div className="space-y-2">
                            <Label>Voice</Label>
                            <VoiceSelector value={voice} onValueChange={onVoiceChange} />
                        </div>
                    )}

                    {/* Qwen3-TTS specific settings */}
                    {engine === "qwen3" && (
                        <>
                            {/* Model Status & Load Button */}
                            <Qwen3ModelStatus />

                            <div className="space-y-2">
                                <Label>Speaker</Label>
                                <Select
                                    value={voice}
                                    onValueChange={onVoiceChange}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select speaker" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="aiden">Aiden (English)</SelectItem>
                                        <SelectItem value="dylan">Dylan (English)</SelectItem>
                                        <SelectItem value="eric">Eric (English)</SelectItem>
                                        <SelectItem value="ryan">Ryan (English)</SelectItem>
                                        <SelectItem value="serena">Serena (English)</SelectItem>
                                        <SelectItem value="vivian">Vivian (Chinese)</SelectItem>
                                        <SelectItem value="uncle_fu">Uncle Fu (Chinese)</SelectItem>
                                        <SelectItem value="ono_anna">Ono Anna (Japanese)</SelectItem>
                                        <SelectItem value="sohee">Sohee (Korean)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    <span>Style Instruction</span>
                                    <span className="text-xs text-muted-foreground ml-2">(optional)</span>
                                </Label>
                                <Textarea
                                    placeholder="e.g., Speak happily and excitedly"
                                    value={instruct}
                                    onChange={(e) => onInstructChange(e.target.value)}
                                    className="h-20 resize-none text-sm"
                                />
                            </div>
                        </>
                    )}

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
                                {(engine === "qwen3" ? QWEN3_LANGUAGE_OPTIONS : KOKORO_LANGUAGE_OPTIONS).map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {engine === "kokoro" && (
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
                    )}
                </div>

                {/* Separator */}
                <div className="border-t border-border" />

                {/* Text Processing Settings */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>Text Model</Label>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => {
                                    queryClient.invalidateQueries({ queryKey: ["llm-status"] })
                                    queryClient.invalidateQueries({ queryKey: ["llm-models"] })
                                    queryClient.invalidateQueries({ queryKey: ["llm-model-status"] })
                                }}
                                title="Refresh LLM status"
                            >
                                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                        </div>
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
