import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { SpinnerGapIcon, PowerIcon, CircleIcon, ArrowsClockwiseIcon, LightningIcon, SparkleIcon, MicrophoneIcon, PaletteIcon, CaretDownIcon, CheckIcon } from "@phosphor-icons/react"
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { VoiceSelector } from "./VoiceSelector"
import { LLMModelSelector } from "./LLMModelSelector"
import { VoiceManagerDialog } from "./VoiceManagerDialog"
import { CreateVoiceDialog } from "./CustomVoicesSection"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { VoiceProfile } from "@/types"


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
    voiceProfileId: string | null
    onVoiceProfileChange: (profileId: string | null) => void
    chunkSize: number[]
    onChunkSizeChange: (size: number[]) => void
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
                flash_attention: boolean | null
            }
        },
        refetchInterval: 3000,
        retry: false,
    })

    const loadMutation = useMutation({
        mutationFn: async () => {
            await axios.post("http://localhost:8000/api/qwen3/load", {})
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
                <SpinnerGapIcon size={16} className="animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                    <CircleIcon className={cn(
                        "h-2.5 w-2.5 fill-current",
                        isModelLoaded ? "text-green-500" : "text-muted-foreground"
                    )} />
                    <span className={isModelLoaded ? "text-foreground" : "text-muted-foreground"}>
                        {isModelLoaded
                            ? `Model Loaded`
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
                            <SpinnerGapIcon size={16} className="animate-spin" />
                        ) : (
                            <>
                                <PowerIcon size={16} className="mr-1" />
                                Unload
                            </>
                        )}
                    </Button>
                )}
            </div>
            {!isModelLoaded && (
                <Button
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => loadMutation.mutate()}
                    disabled={loadMutation.isPending}
                >
                    {loadMutation.isPending ? (
                        <>
                            <SpinnerGapIcon size={16} className="animate-spin mr-1" />
                            Loading...
                        </>
                    ) : (
                        "Load Model"
                    )}
                </Button>
            )}
            {!modelInfo?.flash_attention && isModelLoaded && (
                <p className="text-xs text-amber-500">
                    ⚠ FlashAttention not available
                </p>
            )}
        </div>
    )
}

// Built-in Qwen3 speakers with language flag
const QWEN3_SPEAKERS = [
    { id: "aiden", name: "Aiden", flag: "🌐" },
    { id: "dylan", name: "Dylan", flag: "🌐" },
    { id: "eric", name: "Eric", flag: "🌐" },
    { id: "ryan", name: "Ryan", flag: "🌐" },
    { id: "serena", name: "Serena", flag: "🌐" },
    { id: "vivian", name: "Vivian", flag: "🇨🇳" },
    { id: "uncle_fu", name: "Uncle Fu", flag: "🇨🇳" },
    { id: "ono_anna", name: "Ono Anna", flag: "🇯🇵" },
    { id: "sohee", name: "Sohee", flag: "🇰🇷" },
]

// Unified voice selector for Qwen3 (built-in + custom voices) with tabbed dropdown
function Qwen3VoiceSelector({
    voice,
    onVoiceChange,
    voiceProfileId,
    onVoiceProfileChange,
}: {
    voice: string
    onVoiceChange: (voice: string) => void
    voiceProfileId: string | null
    onVoiceProfileChange: (profileId: string | null) => void
}) {
    const [open, setOpen] = useState(false)

    const { data: profiles } = useQuery({
        queryKey: ["voice-profiles"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/voice-profiles")
            return res.data.profiles as VoiceProfile[]
        },
    })

    const handleSelectBuiltIn = (speakerId: string) => {
        onVoiceProfileChange(null)
        onVoiceChange(speakerId)
        setOpen(false)
    }

    const handleSelectCustom = (profileId: string) => {
        onVoiceProfileChange(profileId)
        setOpen(false)
    }

    // Find display text for trigger
    const getDisplayLabel = () => {
        if (voiceProfileId) {
            const profile = profiles?.find((p) => p.id === voiceProfileId)
            if (profile) {
                const icon = profile.source === "designed" ? "🎨" : "🎤"
                return `${icon} ${profile.name}`
            }
            return "🎤 Custom Voice"
        }
        const speaker = QWEN3_SPEAKERS.find((s) => s.id === voice)
        return speaker ? `${speaker.flag} ${speaker.name}` : voice
    }

    // Default to custom tab if a custom voice is selected
    const defaultTab = voiceProfileId ? "custom" : "builtin"

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal px-3"
                >
                    <span className="truncate">{getDisplayLabel()}</span>
                    <CaretDownIcon className={cn(
                        "h-4 w-4 shrink-0 opacity-50 transition-transform duration-200",
                        open && "rotate-180"
                    )} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-[var(--radix-dropdown-menu-trigger-width)] p-0"
                align="start"
                sideOffset={4}
            >
                <Tabs defaultValue={defaultTab} className="w-full">
                    {/* Tab headers */}
                    <div className="border-b border-border px-1 pt-1">
                        <TabsList className="w-full h-auto grid grid-cols-2 bg-transparent p-0 gap-1">
                            <TabsTrigger
                                value="builtin"
                                className="px-3 py-1.5 text-xs data-[state=active]:bg-accent hover:bg-accent/50 transition-colors"
                            >
                                Built-in Voices
                            </TabsTrigger>
                            <TabsTrigger
                                value="custom"
                                className="px-3 py-1.5 text-xs data-[state=active]:bg-accent hover:bg-accent/50 transition-colors"
                            >
                                Custom Voices
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* Built-in voices tab */}
                    <TabsContent value="builtin" className="mt-0 focus-visible:ring-0">
                        <ScrollArea className="h-[280px]">
                            <div className="p-1 space-y-0.5">
                                {QWEN3_SPEAKERS.map((speaker) => (
                                    <button
                                        key={speaker.id}
                                        onClick={() => handleSelectBuiltIn(speaker.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-150",
                                            "hover:bg-accent/50 focus:outline-none focus:bg-accent/50",
                                            !voiceProfileId && voice === speaker.id && "bg-accent"
                                        )}
                                    >
                                        <span className="text-sm">{speaker.flag}</span>
                                        <span className="flex-1 text-left text-sm font-medium truncate">
                                            {speaker.name}
                                        </span>
                                        {!voiceProfileId && voice === speaker.id && (
                                            <CheckIcon size={16} className="text-primary shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </ScrollArea>
                    </TabsContent>

                    {/* Custom voices tab */}
                    <TabsContent value="custom" className="mt-0 focus-visible:ring-0">
                        <ScrollArea className="h-[280px]">
                            <div className="p-1 space-y-0.5">
                                {profiles && profiles.length > 0 ? (
                                    profiles.map((profile) => (
                                        <button
                                            key={profile.id}
                                            onClick={() => handleSelectCustom(profile.id)}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-150",
                                                "hover:bg-accent/50 focus:outline-none focus:bg-accent/50",
                                                voiceProfileId === profile.id && "bg-accent"
                                            )}
                                        >
                                            {profile.source === "designed" ? (
                                                <PaletteIcon size={16} className="text-purple-500 shrink-0" />
                                            ) : (
                                                <MicrophoneIcon size={16} className="text-blue-500 shrink-0" />
                                            )}
                                            <span className="flex-1 text-left text-sm font-medium truncate">
                                                {profile.name}
                                            </span>
                                            {voiceProfileId === profile.id && (
                                                <CheckIcon size={16} className="text-primary shrink-0" />
                                            )}
                                        </button>
                                    ))
                                ) : (
                                    <div className="text-center py-8 text-sm text-muted-foreground">
                                        <p>No custom voices yet.</p>
                                        <p className="text-xs mt-1">Use "Manage..." to create one.</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </DropdownMenuContent>
        </DropdownMenu>
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
    voiceProfileId,
    onVoiceProfileChange,
    chunkSize,
    onChunkSizeChange,
}: SettingsSidebarProps) {
    const queryClient = useQueryClient()
    const [voiceManagerOpen, setVoiceManagerOpen] = useState(false)
    const [createVoiceOpen, setCreateVoiceOpen] = useState(false)

    // LLM status
    const { data: modelStatus } = useQuery({
        queryKey: ["llm-model-status"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/llm-model-status")
            return res.data as { model: string; status: string }
        },
        refetchInterval: 5000,
        staleTime: 0,
        retry: false,
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
                                        <LightningIcon size={16} className="text-yellow-500" />
                                        <span>Kokoro</span>
                                    </div>
                                </SelectItem>
                                <SelectItem value="qwen3">
                                    <div className="flex items-center gap-2">
                                        <SparkleIcon size={16} className="text-purple-500" />
                                        <span>Qwen3-TTS</span>
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
                                <div className="flex items-center justify-between">
                                    <Label>Voice</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => setVoiceManagerOpen(true)}
                                    >
                                        Manage...
                                    </Button>
                                </div>
                                <Qwen3VoiceSelector
                                    voice={voice}
                                    onVoiceChange={onVoiceChange}
                                    voiceProfileId={voiceProfileId}
                                    onVoiceProfileChange={onVoiceProfileChange}
                                />
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

                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Chunk Size</Label>
                            <span className="text-sm text-muted-foreground">{chunkSize[0]} chars</span>
                        </div>
                        <Slider
                            value={chunkSize}
                            onValueChange={onChunkSizeChange}
                            min={100}
                            max={2000}
                            step={50}
                        />
                    </div>
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
                                <ArrowsClockwiseIcon size={16} className="text-muted-foreground" />
                            </Button>
                        </div>
                        <LLMModelSelector />
                    </div>

                    {/* Model Status Indicator */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                            {status === "loading" ? (
                                <SpinnerGapIcon className={cn("animate-spin", statusColor)} />
                            ) : (
                                <CircleIcon className={cn("fill-current", statusColor)} />
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
                                    <SpinnerGapIcon size={16} className="animate-spin" />
                                ) : (
                                    <>
                                        <PowerIcon size={16} className="mr-1" />
                                        Unload
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Voice Manager Dialog */}
            <VoiceManagerDialog
                open={voiceManagerOpen}
                onOpenChange={setVoiceManagerOpen}
                selectedProfileId={voiceProfileId}
                onProfileSelect={onVoiceProfileChange}
                onCreateVoice={() => setCreateVoiceOpen(true)}
            />

            {/* Create Voice Dialog */}
            <CreateVoiceDialog
                open={createVoiceOpen}
                onOpenChange={setCreateVoiceOpen}
            />
        </div>
    )
}
