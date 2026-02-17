import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { PlayIcon, DownloadSimpleIcon, FolderOpenIcon, TrashIcon, ClockIcon, DotsThreeVerticalIcon, SpinnerGapIcon, DotsSixVerticalIcon, SquaresFourIcon, ListIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDroppable } from "@dnd-kit/core"
import { useSortable, SortableContext, verticalListSortingStrategy, rectSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"
import { formatVoiceDisplay } from "@/lib/voiceData"
import type { HistoryItem, Project } from "@/types"

type ViewMode = "grid" | "list"

interface ProjectDetailViewProps {
    projectId: string
    projectColor?: string | null
    onSelectGeneration: (item: HistoryItem, autoplay?: boolean) => void
}

function formatDuration(seconds?: number): string {
    if (!seconds) return "--:--"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFilename(filename: string): string {
    const basename = filename.split('/').pop() || filename
    return basename.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
}


// Shared menu for generation items
function GenerationMenu({ gen, onRemove, onShowInExplorer }: {
    gen: HistoryItem
    onRemove: () => void
    onShowInExplorer: () => void
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    <DotsThreeVerticalIcon size={16} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="left">
                <DropdownMenuItem onClick={onShowInExplorer}>
                    <FolderOpenIcon size={16} className="mr-2" /> Show in Explorer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                    const a = document.createElement('a')
                    a.href = `http://localhost:8000${gen.url}`
                    a.download = gen.filename
                    a.click()
                }}>
                    <DownloadSimpleIcon size={16} className="mr-2" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onRemove}>
                    <TrashIcon size={16} className="mr-2" /> Remove from Project
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}


// List Card (existing layout)
function SortableGenerationCard({ gen, projectId, projectColor, onSelect, onPlay, onRemove, onShowInExplorer }: {
    gen: HistoryItem
    projectId: string
    projectColor?: string | null
    onSelect: () => void
    onPlay: () => void
    onRemove: () => void
    onShowInExplorer: () => void
}) {
    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging,
    } = useSortable({
        id: `project-gen-${gen.id}`,
        data: { type: "project-generation", generationId: gen.id, projectId },
    })

    const style = { transform: CSS.Transform.toString(transform), transition }

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "group rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent/50 cursor-pointer overflow-hidden",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            style={{
                ...style,
                borderLeftWidth: projectColor ? '3px' : undefined,
                borderLeftColor: projectColor || undefined,
            }}
            onClick={onSelect}
        >
            <div className="flex gap-2">
                <button
                    {...attributes} {...listeners}
                    className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 mt-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none self-start"
                    onClick={(e) => e.stopPropagation()}
                >
                    <DotsSixVerticalIcon size={16} className="text-muted-foreground" />
                </button>
                <div className="flex-1 min-w-0 space-y-1.5">
                    <h4 className="text-sm font-medium truncate">{formatFilename(gen.filename)}</h4>
                    <p className="text-xs text-muted-foreground leading-tight line-clamp-2 break-words">
                        {gen.text || "No text"}
                    </p>
                    <div className="flex items-center text-xs text-muted-foreground gap-1.5 flex-wrap pt-1">
                        <span>{formatVoiceDisplay(gen.voice, gen.voice_profile_id)}</span>
                        <span>•</span>
                        <span>{gen.speed}x</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                            <ClockIcon size={14} className="shrink-0" />
                            {formatDuration(gen.duration)}
                        </span>
                        <span>•</span>
                        <span>{new Date(gen.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" size="sm" className="h-7 flex-1 text-xs"
                    onClick={(e) => { e.stopPropagation(); onPlay() }}
                >
                    <PlayIcon size={16} className="mr-2" /> Play
                </Button>
                <GenerationMenu gen={gen} onRemove={onRemove} onShowInExplorer={onShowInExplorer} />
            </div>
        </div>
    )
}


// Grid Tile (compact card for grid layout)
function SortableGenerationTile({ gen, projectId, projectColor, onSelect, onPlay, onRemove, onShowInExplorer }: {
    gen: HistoryItem
    projectId: string
    projectColor?: string | null
    onSelect: () => void
    onPlay: () => void
    onRemove: () => void
    onShowInExplorer: () => void
}) {
    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging,
    } = useSortable({
        id: `project-gen-${gen.id}`,
        data: { type: "project-generation", generationId: gen.id, projectId },
    })

    const style = { transform: CSS.Transform.toString(transform), transition }

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "group relative rounded-xl border bg-background p-4 transition-colors cursor-pointer overflow-hidden",
                "hover:bg-accent/50 hover:border-accent-foreground/20",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            style={{
                ...style,
                borderLeftWidth: projectColor ? '3px' : undefined,
                borderLeftColor: projectColor || undefined,
            }}
            onClick={onSelect}
        >
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button
                        {...attributes} {...listeners}
                        className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 -ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <DotsSixVerticalIcon size={16} className="text-muted-foreground" />
                    </button>
                    <h4 className="text-sm font-medium truncate">{formatFilename(gen.filename)}</h4>
                </div>
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <GenerationMenu gen={gen} onRemove={onRemove} onShowInExplorer={onShowInExplorer} />
                </div>
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2 break-words mb-2">
                {gen.text || "No text"}
            </p>

            <div className="flex items-center text-xs text-muted-foreground gap-1.5 flex-wrap">
                <span>{formatVoiceDisplay(gen.voice, gen.voice_profile_id)}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                    <ClockIcon size={14} className="shrink-0" />
                    {formatDuration(gen.duration)}
                </span>
            </div>

            <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" size="sm" className="h-7 w-full text-xs"
                    onClick={(e) => { e.stopPropagation(); onPlay() }}
                >
                    <PlayIcon size={16} className="mr-2" /> Play
                </Button>
            </div>
        </div>
    )
}


// View Toggle
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
    return (
        <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
                onClick={() => onChange("grid")}
                className={cn(
                    "p-1.5 transition-colors",
                    mode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="Grid view"
            >
                <SquaresFourIcon size={16} />
            </button>
            <button
                onClick={() => onChange("list")}
                className={cn(
                    "p-1.5 transition-colors",
                    mode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="List view"
            >
                <ListIcon size={16} />
            </button>
        </div>
    )
}


// Main View
export function ProjectDetailView({ projectId, projectColor, onSelectGeneration }: ProjectDetailViewProps) {
    const queryClient = useQueryClient()

    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        return (localStorage.getItem("sonotext-project-detail-view") as ViewMode) || "list"
    })
    const handleViewChange = (m: ViewMode) => {
        setViewMode(m)
        localStorage.setItem("sonotext-project-detail-view", m)
    }

    const { data: project, isLoading } = useQuery<Project>({
        queryKey: ["projects", projectId],
        queryFn: () => axios.get(`http://localhost:8000/api/projects/${projectId}`).then((r) => r.data),
    })

    const removeMutation = useMutation({
        mutationFn: (generationId: string) =>
            axios.delete(`http://localhost:8000/api/projects/${projectId}/generations/${generationId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["projects", projectId] })
            queryClient.invalidateQueries({ queryKey: ["projects"] })
        },
    })

    const handleShowInExplorer = async (filename: string) => {
        try {
            await axios.post("http://localhost:8000/api/show-in-explorer", { filename })
        } catch (e) {
            console.error("Failed to show in explorer:", e)
        }
    }

    const { setNodeRef, isOver } = useDroppable({
        id: `project-detail-${projectId}`,
        data: { type: "project", projectId },
    })

    const sortableIds = (project?.generations || []).map((g) => `project-gen-${g.id}`)

    if (isLoading || !project) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <SpinnerGapIcon size={24} className="animate-spin text-muted-foreground" />
            </div>
        )
    }

    const strategy = viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy
    const GenerationItem = viewMode === "grid" ? SortableGenerationTile : SortableGenerationCard

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "flex-1 flex flex-col space-y-4 animate-in fade-in duration-200 min-h-0",
                isOver && "ring-2 ring-primary/30 rounded-xl"
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <h2
                        className="text-xl font-semibold tracking-tight truncate"
                        style={{ color: projectColor || undefined }}
                    >
                        {project.name}
                    </h2>
                    <span className="text-sm text-muted-foreground shrink-0">
                        {project.generations.length} generation{project.generations.length !== 1 ? "s" : ""}
                    </span>
                </div>
                <ViewToggle mode={viewMode} onChange={handleViewChange} />
            </div>

            {/* Generation items */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {project.generations.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <p className="text-sm">No generations in this project yet.</p>
                        <p className="text-xs mt-1">Drag items from the history sidebar to add them.</p>
                    </div>
                ) : (
                    <SortableContext items={sortableIds} strategy={strategy}>
                        <div className={viewMode === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}>
                            {project.generations.map((gen) => (
                                <GenerationItem
                                    key={gen.id}
                                    gen={gen}
                                    projectId={projectId}
                                    projectColor={projectColor}
                                    onSelect={() => onSelectGeneration(gen)}
                                    onPlay={() => onSelectGeneration(gen, true)}
                                    onRemove={() => removeMutation.mutate(gen.id)}
                                    onShowInExplorer={() => handleShowInExplorer(gen.filename)}
                                />
                            ))}
                        </div>
                    </SortableContext>
                )}
            </div>
        </div>
    )
}
