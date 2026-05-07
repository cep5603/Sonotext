import { useMemo, useState } from "react"
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
