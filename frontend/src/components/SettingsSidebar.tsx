import { useState, useCallback } from "react"
import { useQuery, useIsMutating } from "@tanstack/react-query"
import axios from "axios"
import { LightningIcon, SparkleIcon, WaveformIcon, MicrophoneIcon, PaletteIcon, CaretDownIcon, CheckIcon, SidebarSimpleIcon, HardDrivesIcon, SpinnerGapIcon, FileTextIcon } from "@phosphor-icons/react"
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
import { ModelManagerDialog } from "./ModelManagerDialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import type { VoiceProfile } from "@/types"


interface SettingsSidebarProps {
    voice: string
    onVoiceChange: (voice: string) => void
    lang: string | null
    onLangChange: (lang: string | null) => void
    speed: number[]
    onSpeedChange: (speed: number[]) => void
    engine: "kokoro" | "qwen3" | "zonos2"
    onEngineChange: (engine: "kokoro" | "qwen3" | "zonos2") => void
    instruct: string
    onInstructChange: (instruct: string) => void
    voiceProfileId: string | null
    onVoiceProfileChange: (profileId: string | null) => void
    seed: string
    onSeedChange: (seed: string) => void
    chunkSize: number[]
    onChunkSizeChange: (size: number[]) => void
    collapsed: boolean
    onToggleCollapse: () => void
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

// Languages supported by the ZONOS2 /tts/generate endpoint
const ZONOS2_LANGUAGE_OPTIONS = [
    { value: "en_us", label: "English (US)" },
    { value: "en_gb", label: "English (UK)" },
    { value: "fr_fr", label: "French" },
    { value: "de", label: "German" },
    { value: "es", label: "Spanish" },
    { value: "it", label: "Italian" },
    { value: "pt_br", label: "Portuguese (BR)" },
    { value: "ja", label: "Japanese" },
    { value: "cmn", label: "Mandarin Chinese" },
    { value: "ko", label: "Korean" },
]



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
                return (
                    <span className="flex items-center gap-1.5">
                        {profile.source === "designed" ? (
                            <PaletteIcon size={14} className="shrink-0 text-purple-500" />
                        ) : (
                            <MicrophoneIcon size={14} className="shrink-0 text-blue-500" />
                        )}
                        {profile.name}
                    </span>
                )
            }
            return (
                <span className="flex items-center gap-1.5">
                    <MicrophoneIcon size={14} className="shrink-0 text-blue-500" />
                    Custom Voice
                </span>
            )
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


// Voice selector for ZONOS2 (default voice + custom cloned voices)
function Zonos2VoiceSelector({
    onVoiceChange,
    voiceProfileId,
    onVoiceProfileChange,
}: {
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

    const selectDefault = () => {
        onVoiceProfileChange(null)
        onVoiceChange("default")
        setOpen(false)
    }

    const selectCustom = (profileId: string) => {
        onVoiceProfileChange(profileId)
        setOpen(false)
    }

    const getDisplayLabel = () => {
        if (voiceProfileId) {
            const profile = profiles?.find((p) => p.id === voiceProfileId)
            return (
                <span className="flex items-center gap-1.5">
                    <MicrophoneIcon size={14} className="shrink-0 text-blue-500" />
                    {profile ? profile.name : "Custom Voice"}
                </span>
            )
        }
        return (
            <span className="flex items-center gap-1.5">
                <WaveformIcon size={14} className="shrink-0 text-emerald-500" />
                Default
            </span>
        )
    }

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
                <ScrollArea className="max-h-[300px]">
                    <div className="p-1 space-y-0.5">
                        <button
                            onClick={selectDefault}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-150",
                                "hover:bg-accent/50 focus:outline-none focus:bg-accent/50",
                                !voiceProfileId && "bg-accent"
                            )}
                        >
                            <WaveformIcon size={16} className="text-emerald-500 shrink-0" />
                            <span className="flex-1 text-left text-sm font-medium truncate">Default</span>
                            {!voiceProfileId && (
                                <CheckIcon size={16} className="text-primary shrink-0" />
                            )}
                        </button>

                        {profiles && profiles.length > 0 && (
                            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Cloned Voices
                            </div>
                        )}
                        {profiles?.map((profile) => (
                            <button
                                key={profile.id}
                                onClick={() => selectCustom(profile.id)}
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
                        ))}
                    </div>
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}


// Model Manager footer with live status
function ModelManagerFooter({ collapsed, onOpen }: { collapsed: boolean; onOpen: () => void }) {
    const { data } = useQuery<{ models: { loaded: boolean; loading?: boolean }[] }>({
        queryKey: ["model-registry"],
        staleTime: Infinity,
        enabled: false, // populated by SSE stream only
    })

    const isMutating = useIsMutating({ mutationKey: ["model-action"] })

    const models = data?.models ?? []
    const loadedCount = models.filter((m) => m.loaded).length
    const anyLoading = isMutating > 0 || models.some((m) => m.loading)

    return (
        <div className={cn("border-t border-border px-3 py-2.5 shrink-0 space-y-1", collapsed && "hidden")}>
            <div>
                <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
                    onClick={onOpen}
                >
                    <HardDrivesIcon size={20} />
                    Model Manager
                </Button>
                <p className="text-xs text-muted-foreground/70 pl-2 mt-0.5 flex items-center gap-1.5">
                    {anyLoading ? (
                        <>
                            <SpinnerGapIcon size={10} className="animate-spin" />
                            <span>Loading model…</span>
                        </>
                    ) : models.length > 0 ? (
                        <span>{loadedCount} model{loadedCount !== 1 ? "s" : ""} loaded</span>
                    ) : (
                        <span>&nbsp;</span>
                    )}
                </p>
            </div>
            <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => window.dispatchEvent(new Event('sonotext-open-logs'))}
            >
                <FileTextIcon size={20} />
                View Logs
            </Button>
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
    voiceProfileId,
    onVoiceProfileChange,
    seed,
    onSeedChange,
    chunkSize,
    onChunkSizeChange,
    collapsed,
    onToggleCollapse,
}: SettingsSidebarProps) {
    const [voiceManagerOpen, setVoiceManagerOpen] = useState(false)
    const [createVoiceOpen, setCreateVoiceOpen] = useState(false)
    const [modelManagerOpen, setModelManagerOpen] = useState(false)

    const handleSpeedWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const direction = e.deltaY < 0 ? 1 : -1
        const next = Math.round((speed[0] + direction * 0.1) * 10) / 10
        onSpeedChange([Math.max(0.5, Math.min(2.0, next))])
    }, [speed, onSpeedChange])

    const handleChunkSizeWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const direction = e.deltaY < 0 ? 1 : -1
        const next = chunkSize[0] + direction * 50
        onChunkSizeChange([Math.max(100, Math.min(2000, next))])
    }, [chunkSize, onChunkSizeChange])



    return (
        <div className={cn(
            "border-r border-border bg-card/50 backdrop-blur-sm h-full flex flex-col shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden",
            collapsed ? "w-12" : "w-64"
        )}>
            <div className={cn(
                "p-4 border-b border-border shrink-0 flex items-center",
                collapsed ? "justify-center" : "justify-between"
            )}>
                {!collapsed && <h2 className="font-semibold tracking-tight">Settings</h2>}
                <button
                    type="button"
                    onClick={onToggleCollapse}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                    aria-label={collapsed ? "Expand settings" : "Collapse settings"}
                >
                    <SidebarSimpleIcon size={20} className={cn(collapsed && "rotate-180")} />
                </button>
            </div>

            <div className={cn("flex-1 overflow-y-auto p-4 space-y-6", collapsed && "hidden")}>
                {/* Voice Synthesis Settings */}
                <div className="space-y-4">
                    {/* TTS Engine Selector */}
                    <div className="space-y-2">
                        <Label>TTS Engine</Label>
                        <Select
                            value={engine}
                            onValueChange={(v) => onEngineChange(v as "kokoro" | "qwen3" | "zonos2")}
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
                                <SelectItem value="zonos2">
                                    <div className="flex items-center gap-2">
                                        <WaveformIcon size={16} className="text-emerald-500" />
                                        <span>ZONOS2</span>
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

                    {/* ZONOS2-specific settings */}
                    {engine === "zonos2" && (
                        <>
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
                                <Zonos2VoiceSelector
                                    onVoiceChange={onVoiceChange}
                                    voiceProfileId={voiceProfileId}
                                    onVoiceProfileChange={onVoiceProfileChange}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Pick a custom voice to clone it, or use the model's default voice.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    <span>Seed</span>
                                    <span className="text-xs text-muted-foreground ml-2">(optional)</span>
                                </Label>
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    placeholder="Random"
                                    value={seed}
                                    onChange={(e) => onSeedChange(e.target.value)}
                                    className="text-sm"
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
                                {(engine === "qwen3" ? QWEN3_LANGUAGE_OPTIONS : engine === "zonos2" ? ZONOS2_LANGUAGE_OPTIONS : KOKORO_LANGUAGE_OPTIONS).map((opt) => (
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
                            <div onWheel={handleSpeedWheel}>
                                <Slider
                                    value={speed}
                                    onValueChange={onSpeedChange}
                                    min={0.5}
                                    max={2.0}
                                    step={0.1}
                                />
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Chunk Size</Label>
                            <span className="text-sm text-muted-foreground">{chunkSize[0]} chars</span>
                        </div>
                        <div onWheel={handleChunkSizeWheel}>
                            <Slider
                                value={chunkSize}
                                onValueChange={onChunkSizeChange}
                                min={100}
                                max={2000}
                                step={50}
                            />
                        </div>
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
                </div>
            </div>

            {/* Model Manager Button */}
            <ModelManagerFooter
                collapsed={collapsed}
                onOpen={() => setModelManagerOpen(true)}
            />

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

            {/* Model Manager Dialog */}
            <ModelManagerDialog
                open={modelManagerOpen}
                onOpenChange={setModelManagerOpen}
            />
        </div>
    )
}
