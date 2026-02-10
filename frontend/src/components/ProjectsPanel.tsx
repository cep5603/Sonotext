import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Plus, MoreVertical, Trash2, SquarePen, Loader2, X, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useSortable, SortableContext, rectSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Project } from "@/types"

interface ProjectsPanelProps {
    onOpenProject: (project: Project) => void
}

// Display format: strip extension, UUID suffix, replace hyphens with spaces
function formatFilename(filename: string): string {
    const basename = filename.split('/').pop() || filename
    return basename.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
}


// Sortable + Droppable Project Tile

function ProjectTile({ project, onOpen, onRename, onDelete }: {
    project: Project
    onOpen: () => void
    onRename: (name: string) => void
    onDelete: () => void
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({
        id: `project-${project.id}`,
        data: { type: "project", projectId: project.id },
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const startEditing = (e?: React.MouseEvent) => {
        e?.stopPropagation()
        setEditValue(project.name)
        setIsEditing(true)
    }

    const confirmRename = () => {
        const trimmed = editValue.trim()
        if (trimmed && trimmed !== project.name) {
            onRename(trimmed)
        }
        setIsEditing(false)
    }

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const count = project.generations.length

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "group relative rounded-xl border bg-background p-4 transition-colors cursor-pointer",
                "hover:bg-accent/50 hover:border-accent-foreground/20",
                isOver && "border-primary bg-primary/10 ring-2 ring-primary/30",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            onClick={onOpen}
        >
            {/* Header: drag handle + name + menu */}
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {/* Drag handle */}
                    <button
                        {...attributes}
                        {...listeners}
                        className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 -ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>

                    {isEditing ? (
                        <input
                            ref={inputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") confirmRename()
                                if (e.key === "Escape") setIsEditing(false)
                            }}
                            onBlur={confirmRename}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    ) : (
                        <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                    )}
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <MoreVertical className="h-3 w-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => startEditing()}>
                            <SquarePen className="mr-2 h-3 w-3" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={onDelete}
                        >
                            <Trash2 className="mr-2 h-3 w-3" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Count badge */}
            <p className="text-xs text-muted-foreground mb-2">
                {count} generation{count !== 1 ? "s" : ""}
            </p>

            {/* Recent generation previews */}
            {project.generations.length > 0 ? (
                <div className="space-y-1">
                    {project.generations.slice(0, 3).map((gen) => (
                        <p
                            key={gen.id}
                            className="text-xs text-muted-foreground truncate leading-tight"
                        >
                            {formatFilename(gen.filename)}
                        </p>
                    ))}
                    {project.generations.length > 3 && (
                        <p className="text-xs text-muted-foreground/50">
                            +{project.generations.length - 3} more
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground/50 italic">
                    Drag items here
                </p>
            )}
        </div>
    )
}


// New Project Tile

function NewProjectTile({ onCreate }: { onCreate: (name: string) => void }) {
    const [isCreating, setIsCreating] = useState(false)
    const [name, setName] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isCreating && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isCreating])

    const handleCreate = () => {
        const trimmed = name.trim()
        if (trimmed) {
            onCreate(trimmed)
        }
        setName("")
        setIsCreating(false)
    }

    if (isCreating) {
        return (
            <div className="rounded-xl border-2 border-dashed border-primary/40 p-4 flex flex-col justify-center">
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Project name..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreate()
                        if (e.key === "Escape") { setIsCreating(false); setName("") }
                    }}
                    onBlur={handleCreate}
                    className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-2"
                />
                <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs flex-1" onClick={handleCreate}>
                        Create
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => { setIsCreating(false); setName("") }}
                    >
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <button
            onClick={() => setIsCreating(true)}
            className={cn(
                "rounded-xl border-2 border-dashed border-muted-foreground/20 p-4",
                "flex flex-col items-center justify-center gap-2 min-h-[120px]",
                "text-muted-foreground hover:border-primary/50 hover:text-foreground",
                "transition-all cursor-pointer"
            )}
        >
            <Plus className="h-6 w-6" />
            <span className="text-sm font-medium">New Project</span>
        </button>
    )
}


// Main Panel

export function ProjectsPanel({ onOpenProject }: ProjectsPanelProps) {
    const queryClient = useQueryClient()

    const { data: projects = [], isLoading } = useQuery<Project[]>({
        queryKey: ["projects"],
        queryFn: () => axios.get("http://localhost:8000/api/projects").then((r) => r.data),
    })

    const createMutation = useMutation({
        mutationFn: (name: string) =>
            axios.post("http://localhost:8000/api/projects", { name }).then((r) => r.data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    })

    const renameMutation = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            axios.patch(`http://localhost:8000/api/projects/${id}`, { name }).then((r) => r.data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) =>
            axios.delete(`http://localhost:8000/api/projects/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    })

    // Sortable IDs for dnd-kit (must match the useSortable ids)
    const sortableIds = projects.map((p) => `project-${p.id}`)

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col space-y-4 animate-in fade-in duration-200 min-h-0">
            <div className="flex-1 overflow-y-auto">
                <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        {projects.map((project) => (
                            <ProjectTile
                                key={project.id}
                                project={project}
                                onOpen={() => onOpenProject(project)}
                                onRename={(name) => renameMutation.mutate({ id: project.id, name })}
                                onDelete={() => deleteMutation.mutate(project.id)}
                            />
                        ))}
                        <NewProjectTile onCreate={(name) => createMutation.mutate(name)} />
                    </div>
                </SortableContext>
            </div>
        </div>
    )
}
