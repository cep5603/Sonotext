import { useMemo, useState, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import {
    SpinnerGapIcon,
    CircleIcon,
    ArrowsClockwiseIcon,
    PlugIcon,
    PlugsIcon,
    LightningIcon,
    SparkleIcon,
    ChatTextIcon,
    WaveformIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface ModelEntry {
    id: string
    name: string
    category: "tts" | "alignment" | "llm"
    loaded: boolean
    size_label: string
    detail?: string | null
    can_unload: boolean
    can_load: boolean
    offline?: boolean
}

interface ModelRegistryResponse {
    models: ModelEntry[]
}

type ModelManagerDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
}

const CATEGORY_META: Record<
    string,
    { label: string; icon: React.ReactNode; order: number }
> = {
    tts: {
        label: "Text-to-Speech",
        icon: <WaveformIcon size={20} className="text-purple-400" />,
        order: 0,
    },
    alignment: {
        label: "Alignment",
        icon: <LightningIcon size={20} className="text-amber-400" />,
        order: 1,
    },
    llm: {
        label: "Text Processing (LM Studio)",
        icon: <ChatTextIcon size={20} className="text-sky-400" />,
        order: 2,
    },
}

function ModelRow({
    model,
    onLoad,
    onUnload,
    isPending,
}: {
    model: ModelEntry
    onLoad: () => void
    onUnload: () => void
    isPending: boolean
}) {
    // Choose sub-icon for TTS models
    const subIcon = useMemo(() => {
        if (model.id.startsWith("kokoro:")) {
            return <LightningIcon size={14} className="text-yellow-500 shrink-0" />
        }
        if (model.id.startsWith("qwen3:")) {
            return <SparkleIcon size={14} className="text-purple-500 shrink-0" />
        }
        if (model.id === "zonos2") {
            return <WaveformIcon size={14} className="text-emerald-500 shrink-0" />
        }
        return null
    }, [model.id])

    return (
        <div className="group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors hover:bg-accent/30">
            {/* Status dot */}
            <CircleIcon
                weight="fill"
                size={8}
                className={cn(
                    "shrink-0 transition-colors",
                    model.loaded ? "text-emerald-500" : "text-zinc-600"
                )}
            />

            {/* Name + detail */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
                {subIcon}
                <span
                    className={cn(
                        "text-sm font-medium truncate",
                        model.loaded ? "text-foreground" : "text-muted-foreground"
                    )}
                >
                    {model.name}
                </span>
                {model.detail && (
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                        {model.detail}
                    </span>
                )}
            </div>

            {/* Size badge */}
            <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 shrink-0 font-normal"
            >
                {model.size_label}
            </Badge>

            {/* Action butto */}
            <div className="w-[72px] flex justify-end shrink-0">
                {model.offline ? (
                    <span className="text-xs text-amber-500">Offline</span>
                ) : model.loaded && model.can_unload ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={onUnload}
                        disabled={isPending}
                    >
                        {isPending ? (
                            <SpinnerGapIcon size={16} className="animate-spin" />
                        ) : (
                            <>
                                <PlugsIcon size={16} className="mr-1" />
                                Unload
                            </>
                        )}
                    </Button>
                ) : !model.loaded && model.can_load ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={onLoad}
                        disabled={isPending}
                    >
                        {isPending ? (
                            <SpinnerGapIcon size={16} className="animate-spin" />
                        ) : (
                            <>
                                <PlugIcon size={16} className="mr-1" />
                                Load
                            </>
                        )}
                    </Button>
                ) : null}
            </div>
        </div>
    )
}

interface Zonos2Config {
    distro: string
    repo_dir: string
    model_path: string
    host: string
    bind_host: string
    port: number
    dtype: string
    default_voices_dir: string
    extra_args: string
    auto_launch: boolean
}

interface Zonos2Status {
    running: boolean
    launching: boolean
    wsl_available: boolean
    base_url: string
    config: Zonos2Config
    last_error: string | null
}

// ZONOS2 runs as a server inside WSL2. This panel surfaces its live status and
// lets the user configure the WSL distro / repo / model and start/stop it.
function Zonos2Section() {
    const queryClient = useQueryClient()
    const { data: status } = useQuery({
        queryKey: ["zonos2-status"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/zonos2/status")
            return res.data as Zonos2Status
        },
        refetchInterval: 2000,
        retry: false,
    })

    const [form, setForm] = useState<Zonos2Config | null>(null)
    const initRef = useRef(false)
    useEffect(() => {
        if (status?.config && !initRef.current) {
            setForm(status.config)
            initRef.current = true
        }
    }, [status])

    const saveMutation = useMutation({
        mutationFn: async (cfg: Zonos2Config) => {
            await axios.put("http://localhost:8000/api/zonos2/config", cfg)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["zonos2-status"] }),
    })

    const startMutation = useMutation({
        mutationKey: ["model-action"],
        mutationFn: async () => {
            await axios.post("http://localhost:8000/api/zonos2/start")
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["zonos2-status"] })
            queryClient.invalidateQueries({ queryKey: ["model-registry"] })
        },
    })

    const stopMutation = useMutation({
        mutationKey: ["model-action"],
        mutationFn: async () => {
            await axios.post("http://localhost:8000/api/zonos2/stop")
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["zonos2-status"] })
            queryClient.invalidateQueries({ queryKey: ["model-registry"] })
        },
    })

    if (!form) return null

    const running = !!status?.running
    const launching = !!status?.launching
    const wslAvailable = status?.wsl_available !== false

    const update = (key: keyof Zonos2Config, value: string | number | boolean) =>
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

    return (
        <div className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <WaveformIcon size={18} className="text-emerald-400 shrink-0" />
                    <span className="text-sm font-semibold">ZONOS2 Server (WSL2)</span>
                    <Badge
                        variant="secondary"
                        className={cn(
                            "text-[10px] px-1.5 py-0 font-normal shrink-0",
                            running ? "text-emerald-400" : launching ? "text-amber-400" : "text-muted-foreground"
                        )}
                    >
                        {running ? "Running" : launching ? "Launching…" : "Stopped"}
                    </Badge>
                </div>
                {running ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs shrink-0"
                        onClick={() => stopMutation.mutate()}
                        disabled={stopMutation.isPending}
                    >
                        {stopMutation.isPending ? (
                            <SpinnerGapIcon size={16} className="animate-spin" />
                        ) : (
                            <><PlugsIcon size={16} className="mr-1" />Stop</>
                        )}
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs shrink-0"
                        onClick={() => startMutation.mutate()}
                        disabled={startMutation.isPending || launching || !wslAvailable}
                    >
                        {(startMutation.isPending || launching) ? (
                            <SpinnerGapIcon size={16} className="animate-spin" />
                        ) : (
                            <><PlugIcon size={16} className="mr-1" />Start</>
                        )}
                    </Button>
                )}
            </div>

            {!wslAvailable && (
                <p className="text-xs text-amber-500">
                    WSL2 was not detected. Install WSL2 and set up ZONOS2 (see zonos2/SETUP.md).
                </p>
            )}

            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">WSL distro</Label>
                    <Input
                        className="h-8 text-xs"
                        placeholder="(default)"
                        value={form.distro}
                        onChange={(e) => update("distro", e.target.value)}
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Port</Label>
                    <Input
                        className="h-8 text-xs"
                        type="number"
                        value={form.port}
                        onChange={(e) => update("port", Number(e.target.value) || 1919)}
                    />
                </div>
                <div className="space-y-1 col-span-2">
                    <Label className="text-xs text-muted-foreground">Repo path (in WSL)</Label>
                    <Input
                        className="h-8 text-xs font-mono"
                        value={form.repo_dir}
                        onChange={(e) => update("repo_dir", e.target.value)}
                    />
                </div>
                <div className="space-y-1 col-span-2">
                    <Label className="text-xs text-muted-foreground">Model path</Label>
                    <Input
                        className="h-8 text-xs font-mono"
                        value={form.model_path}
                        onChange={(e) => update("model_path", e.target.value)}
                    />
                </div>
            </div>

            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => update("auto_launch", !form.auto_launch)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                    <span className={cn(
                        "inline-flex h-4 w-7 items-center rounded-full transition-colors",
                        form.auto_launch ? "bg-emerald-500/70" : "bg-muted"
                    )}>
                        <span className={cn(
                            "h-3 w-3 rounded-full bg-white transition-transform mx-0.5",
                            form.auto_launch && "translate-x-3"
                        )} />
                    </span>
                    Auto-launch on generate
                </button>
                <Button
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => form && saveMutation.mutate(form)}
                    disabled={saveMutation.isPending}
                >
                    {saveMutation.isPending ? <SpinnerGapIcon size={14} className="animate-spin mr-1" /> : null}
                    Save
                </Button>
            </div>

            {status?.last_error && !running && (
                <p className="text-xs text-destructive break-words">{status.last_error}</p>
            )}
        </div>
    )
}

export function ModelManagerDialog({ open, onOpenChange }: ModelManagerDialogProps) {
    const queryClient = useQueryClient()
    const [pendingId, setPendingId] = useState<string | null>(null)

    const { data } = useQuery({
        queryKey: ["model-registry"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/models")
            return res.data as ModelRegistryResponse
        },
        staleTime: 4_000,
        retry: false,
    })

    const loadMutation = useMutation({
        mutationKey: ["model-action"],
        mutationFn: async (modelId: string) => {
            setPendingId(modelId)
            await axios.post(`http://localhost:8000/api/models/${modelId}/load`)
        },
        onSettled: () => {
            setPendingId(null)
            queryClient.invalidateQueries({ queryKey: ["model-registry"] })
            queryClient.invalidateQueries({ queryKey: ["qwen3-info"] })
        },
    })

    const unloadMutation = useMutation({
        mutationKey: ["model-action"],
        mutationFn: async (modelId: string) => {
            setPendingId(modelId)
            await axios.post(`http://localhost:8000/api/models/${modelId}/unload`)
        },
        onSettled: () => {
            setPendingId(null)
            queryClient.invalidateQueries({ queryKey: ["model-registry"] })
            queryClient.invalidateQueries({ queryKey: ["qwen3-info"] })
            queryClient.invalidateQueries({ queryKey: ["llm-model-status"] })
            queryClient.invalidateQueries({ queryKey: ["llm-models"] })
        },
    })

    // Group models by category
    const groups = useMemo(() => {
        const models = data?.models ?? []
        const grouped: Record<string, ModelEntry[]> = {}
        for (const m of models) {
            // ZONOS2 has its own dedicated config panel; skip the generic row.
            if (m.id === "zonos2") continue
            const cat = m.category
            if (!grouped[cat]) grouped[cat] = []
            grouped[cat].push(m)
        }
        // Sort categories by defined order
        return Object.entries(grouped).sort(
            ([a], [b]) =>
                (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
        )
    }, [data])

    const loadedCount = data?.models.filter((m) => m.loaded).length ?? 0
    const totalCount = data?.models.length ?? 0

    const handleRefresh = () => {
        queryClient.invalidateQueries({ queryKey: ["model-registry"] })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[min(680px,calc(100vh-2rem))] max-w-[min(640px,calc(100vw-2rem))] flex-col border-border/80 bg-background/95 p-0 shadow-2xl backdrop-blur">
                <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
                    <DialogTitle>Model Manager</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 mt-1">
                        <span>{loadedCount} of {totalCount} models loaded</span>
                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                            title="Refresh model status"
                        >
                            <ArrowsClockwiseIcon size={14} />
                        </button>
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 min-h-0">
                    <div className="px-4 py-3 space-y-5">
                        <Zonos2Section />
                        {groups.map(([category, models]) => {
                            const meta = CATEGORY_META[category]
                            return (
                                <div key={category}>
                                    {/* Category header */}
                                    <div className="flex items-center gap-2 px-2 pb-2 mb-1">
                                        {meta?.icon}
                                        <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                                            {meta?.label ?? category}
                                        </span>
                                        <div className="flex-1 border-t border-border/40" />
                                    </div>

                                    {/* Model rows */}
                                    <div className="space-y-0.5">
                                        {models.map((model) => (
                                            <ModelRow
                                                key={model.id}
                                                model={model}
                                                onLoad={() => loadMutation.mutate(model.id)}
                                                onUnload={() => unloadMutation.mutate(model.id)}
                                                isPending={pendingId === model.id}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )
                        })}

                        {groups.length === 0 && (
                            <div className="text-center py-12 text-sm text-muted-foreground">
                                <SpinnerGapIcon size={20} className="animate-spin mx-auto mb-2" />
                                Loading model registry...
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
