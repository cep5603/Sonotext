import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Play, Download, FolderOpen, Trash2, Clock, MoreVertical, Loader2, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDroppable } from "@dnd-kit/core"
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"
import { formatVoiceDisplay } from "@/lib/voiceData"
import type { HistoryItem, Project } from "@/types"

interface ProjectDetailViewProps {
    projectId: string
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



// Sortable Generation Card

function SortableGenerationCard({ gen, projectId, onSelect, onPlay, onRemove, onShowInExplorer }: {
    gen: HistoryItem
    projectId: string
    onSelect: () => void
    onPlay: () => void
    onRemove: () => void
    onShowInExplorer: () => void
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: `project-gen-${gen.id}`,
        data: { type: "project-generation", generationId: gen.id, projectId },
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "group rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent/50 cursor-pointer",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            onClick={onSelect}
        >
            <div className="flex gap-2">
                {/* Drag handle */}
                <button
                    {...attributes}
                    {...listeners}
                    className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 mt-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none self-start"
                    onClick={(e) => e.stopPropagation()}
                >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                <div className="flex-1 min-w-0 space-y-1.5">
                    <h4 className="text-sm font-medium truncate">
                        {formatFilename(gen.filename)}
                    </h4>
                    <p className="text-xs text-muted-foreground leading-tight line-clamp-2 break-words">
                        {gen.text || "No text"}
                    </p>
                    <div className="flex items-center text-xs text-muted-foreground gap-1.5 flex-wrap pt-1">
                        <span>{formatVoiceDisplay(gen.voice, gen.voice_profile_id)}</span>
                        <span>•</span>
                        <span>{gen.speed}x</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            {formatDuration(gen.duration)}
                        </span>
                        <span>•</span>
                        <span>{new Date(gen.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={(e) => {
                        e.stopPropagation()
                        onPlay()
                    }}
                >
                    <Play className="mr-2 h-3 w-3" />
                    Play
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                            <MoreVertical className="h-3 w-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="left">
                        <DropdownMenuItem onClick={onShowInExplorer}>
                            <FolderOpen className="mr-2 h-3 w-3" /> Show in Explorer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                            const a = document.createElement('a')
                            a.href = `http://localhost:8000${gen.url}`
                            a.download = gen.filename
                            a.click()
                        }}>
                            <Download className="mr-2 h-3 w-3" /> Download
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={onRemove}
                        >
                            <Trash2 className="mr-2 h-3 w-3" /> Remove from Project
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}


// Main View

export function ProjectDetailView({ projectId, onSelectGeneration }: ProjectDetailViewProps) {
    const queryClient = useQueryClient()

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

    // Make the entire detail view a drop target so users can drop items while viewing a project
    const { setNodeRef, isOver } = useDroppable({
        id: `project-detail-${projectId}`,
        data: { type: "project", projectId },
    })

    // Sortable IDs for generation cards
    const sortableIds = (project?.generations || []).map((g) => `project-gen-${g.id}`)

    if (isLoading || !project) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "flex-1 flex flex-col space-y-4 animate-in fade-in duration-200 min-h-0",
                isOver && "ring-2 ring-primary/30 rounded-xl"
            )}
        >
            {/* Header */}
            <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight truncate">{project.name}</h2>
                <span className="text-sm text-muted-foreground shrink-0">
                    {project.generations.length} generation{project.generations.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Generation list */}
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                {project.generations.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <p className="text-sm">No generations in this project yet.</p>
                        <p className="text-xs mt-1">Drag items from the history sidebar to add them.</p>
                    </div>
                ) : (
                    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                        {project.generations.map((gen) => (
                            <SortableGenerationCard
                                key={gen.id}
                                gen={gen}
                                projectId={projectId}
                                onSelect={() => onSelectGeneration(gen)}
                                onPlay={() => onSelectGeneration(gen, true)}
                                onRemove={() => removeMutation.mutate(gen.id)}
                                onShowInExplorer={() => handleShowInExplorer(gen.filename)}
                            />
                        ))}
                    </SortableContext>
                )}
            </div>
        </div>
    )
}
