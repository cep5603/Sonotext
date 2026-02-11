import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Plus, MoreVertical, Trash2, SquarePen, Loader2, X, GripVertical, LayoutGrid, LayoutList } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useSortable, SortableContext, rectSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Project } from "@/types"

type ViewMode = "grid" | "list"

interface ProjectsPanelProps {
    onOpenProject: (project: Project) => void
}

function formatFilename(filename: string): string {
    const basename = filename.split('/').pop() || filename
    return basename.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
}


// Shared editable name + menu logic
interface SortableProjectProps {
    project: Project
    onOpen: () => void
    onRename: (name: string) => void
    onDelete: () => void
}


// Grid Tile
function ProjectTile({ project, onOpen, onRename, onDelete }: SortableProjectProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging, isOver,
    } = useSortable({
        id: `project-${project.id}`,
        data: { type: "project", projectId: project.id },
    })

    const style = { transform: CSS.Transform.toString(transform), transition }

    const startEditing = (e?: React.MouseEvent) => {
        e?.stopPropagation()
        setEditValue(project.name)
        setIsEditing(true)
    }

    const confirmRename = () => {
        const trimmed = editValue.trim()
        if (trimmed && trimmed !== project.name) onRename(trimmed)
        setIsEditing(false)
    }

    useEffect(() => {
        if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() }
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
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button
                        {...attributes} {...listeners}
                        className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 -ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    {isEditing ? (
                        <input
                            ref={inputRef} type="text" value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setIsEditing(false) }}
                            onBlur={confirmRename}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    ) : (
                        <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                    )}
                </div>
                <ProjectMenu onRename={() => startEditing()} onDelete={onDelete} />
            </div>
            <p className="text-xs text-muted-foreground mb-2">
                {count} generation{count !== 1 ? "s" : ""}
            </p>
            {project.generations.length > 0 ? (
                <div className="space-y-1">
                    {project.generations.slice(0, 3).map((gen) => (
                        <p key={gen.id} className="text-xs text-muted-foreground truncate leading-tight">
                            {formatFilename(gen.filename)}
                        </p>
                    ))}
                    {project.generations.length > 3 && (
                        <p className="text-xs text-muted-foreground/50">+{project.generations.length - 3} more</p>
                    )}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground/50 italic">Drag items here</p>
            )}
        </div>
    )
}


// List Row
function ProjectRow({ project, onOpen, onRename, onDelete }: SortableProjectProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging, isOver,
    } = useSortable({
        id: `project-${project.id}`,
        data: { type: "project", projectId: project.id },
    })

    const style = { transform: CSS.Transform.toString(transform), transition }

    const startEditing = (e?: React.MouseEvent) => {
        e?.stopPropagation()
        setEditValue(project.name)
        setIsEditing(true)
    }

    const confirmRename = () => {
        const trimmed = editValue.trim()
        if (trimmed && trimmed !== project.name) onRename(trimmed)
        setIsEditing(false)
    }

    useEffect(() => {
        if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() }
    }, [isEditing])

    const count = project.generations.length

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "group flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 transition-colors cursor-pointer",
                "hover:bg-accent/50 hover:border-accent-foreground/20",
                isOver && "border-primary bg-primary/10 ring-2 ring-primary/30",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            onClick={onOpen}
        >
            <button
                {...attributes} {...listeners}
                className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none"
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <div className="flex-1 min-w-0">
                {isEditing ? (
                    <input
                        ref={inputRef} type="text" value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setIsEditing(false) }}
                        onBlur={confirmRename}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                ) : (
                    <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {count} generation{count !== 1 ? "s" : ""}
            </span>
            <ProjectMenu onRename={() => startEditing()} onDelete={onDelete} />
        </div>
    )
}


// Shared dropdown menu
function ProjectMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <MoreVertical className="h-3 w-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onRename}>
                    <SquarePen className="mr-2 h-3 w-3" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                    <Trash2 className="mr-2 h-3 w-3" /> Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}


// New Project controls
function NewProjectTile({ onCreate }: { onCreate: (name: string) => void }) {
    const [isCreating, setIsCreating] = useState(false)
    const [name, setName] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isCreating && inputRef.current) inputRef.current.focus()
    }, [isCreating])

    const handleCreate = () => {
        const trimmed = name.trim()
        if (trimmed) onCreate(trimmed)
        setName("")
        setIsCreating(false)
    }

    if (isCreating) {
        return (
            <div className="rounded-xl border-2 border-dashed border-primary/40 p-4 flex flex-col justify-center">
                <input
                    ref={inputRef} type="text" placeholder="Project name..." value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setIsCreating(false); setName("") } }}
                    onBlur={handleCreate}
                    className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-2"
                />
                <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs flex-1" onClick={handleCreate}>Create</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setIsCreating(false); setName("") }}>
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

function NewProjectRow({ onCreate }: { onCreate: (name: string) => void }) {
    const [isCreating, setIsCreating] = useState(false)
    const [name, setName] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isCreating && inputRef.current) inputRef.current.focus()
    }, [isCreating])

    const handleCreate = () => {
        const trimmed = name.trim()
        if (trimmed) onCreate(trimmed)
        setName("")
        setIsCreating(false)
    }

    if (isCreating) {
        return (
            <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-primary/40 px-3 py-2">
                <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                    ref={inputRef} type="text" placeholder="Project name..." value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setIsCreating(false); setName("") } }}
                    onBlur={handleCreate}
                    className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" className="h-7 text-xs" onClick={handleCreate}>Create</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setIsCreating(false); setName("") }}>
                    <X className="h-3 w-3" />
                </Button>
            </div>
        )
    }

    return (
        <button
            onClick={() => setIsCreating(true)}
            className={cn(
                "flex items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 px-3 py-2.5 w-full",
                "text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all cursor-pointer"
            )}
        >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">New Project</span>
        </button>
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
                <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
                onClick={() => onChange("list")}
                className={cn(
                    "p-1.5 transition-colors",
                    mode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="List view"
            >
                <LayoutList className="h-3.5 w-3.5" />
            </button>
        </div>
    )
}


// Main Panel
export function ProjectsPanel({ onOpenProject }: ProjectsPanelProps) {
    const queryClient = useQueryClient()

    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        return (localStorage.getItem("sonotext-projects-view") as ViewMode) || "grid"
    })
    const handleViewChange = (m: ViewMode) => {
        setViewMode(m)
        localStorage.setItem("sonotext-projects-view", m)
    }

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
        mutationFn: (id: string) => axios.delete(`http://localhost:8000/api/projects/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    })

    const sortableIds = projects.map((p) => `project-${p.id}`)

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const strategy = viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy
    const ProjectItem = viewMode === "grid" ? ProjectTile : ProjectRow
    const NewProjectItem = viewMode === "grid" ? NewProjectTile : NewProjectRow

    return (
        <div className="flex-1 flex flex-col space-y-4 animate-in fade-in duration-200 min-h-0">
            <div className="flex items-center justify-between">
                <div />
                <ViewToggle mode={viewMode} onChange={handleViewChange} />
            </div>
            <div className="flex-1 overflow-y-auto">
                <SortableContext items={sortableIds} strategy={strategy}>
                    <div className={viewMode === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-2"}>
                        {projects.map((project) => (
                            <ProjectItem
                                key={project.id}
                                project={project}
                                onOpen={() => onOpenProject(project)}
                                onRename={(name) => renameMutation.mutate({ id: project.id, name })}
                                onDelete={() => deleteMutation.mutate(project.id)}
                            />
                        ))}
                        <NewProjectItem onCreate={(name) => createMutation.mutate(name)} />
                    </div>
                </SortableContext>
            </div>
        </div>
    )
}
