import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { PlusIcon, DotsThreeVerticalIcon, TrashIcon, PencilSimpleIcon, SpinnerGapIcon, XIcon, DotsSixVerticalIcon, SquaresFourIcon, ListIcon, PaletteIcon, CheckIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useSortable, SortableContext, rectSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Project } from "@/types"

type ViewMode = "grid" | "list"

const PROJECT_COLORS: { value: string; label: string }[] = [
    { value: "#dd3131", label: "Red" },
    { value: "#ea580c", label: "Orange" },
    { value: "#d97706", label: "Amber" },
    { value: "#16a34a", label: "Green" },
    { value: "#0d9488", label: "Teal" },
    { value: "#3670ec", label: "Blue" },
    { value: "#8c52ef", label: "Purple" },
    { value: "#de3B84", label: "Pink" },
]

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
    onColorChange: (color: string | null) => void
}


// Grid Tile
function ProjectTile({ project, onOpen, onRename, onDelete, onColorChange }: SortableProjectProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging, isOver,
    } = useSortable({
        id: `project-${project.id}`,
        data: { type: "project", projectId: project.id },
    })

    const sortableStyle = { transform: CSS.Transform.toString(transform), transition }

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
            className={cn(
                "group relative rounded-xl border bg-background p-4 transition-colors cursor-pointer overflow-hidden",
                "hover:bg-accent/50 hover:border-accent-foreground/20",
                isOver && "border-primary bg-primary/10 ring-2 ring-primary/30",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            style={{
                ...sortableStyle,
                borderLeftWidth: project.color ? '3px' : undefined,
                borderLeftColor: project.color || undefined,
            }}
            onClick={onOpen}
        >
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button
                        {...attributes} {...listeners}
                        className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 -ml-1 opacity-60 hover:!opacity-100 transition-opacity touch-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <DotsSixVerticalIcon size={16} className="text-muted-foreground" />
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
                <ProjectMenu onRename={() => startEditing()} onDelete={onDelete} onColorChange={onColorChange} currentColor={project.color} />
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
function ProjectRow({ project, onOpen, onRename, onDelete, onColorChange }: SortableProjectProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging, isOver,
    } = useSortable({
        id: `project-${project.id}`,
        data: { type: "project", projectId: project.id },
    })

    const sortableStyle = { transform: CSS.Transform.toString(transform), transition }

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
            className={cn(
                "group flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 transition-colors cursor-pointer overflow-hidden",
                "hover:bg-accent/50 hover:border-accent-foreground/20",
                isOver && "border-primary bg-primary/10 ring-2 ring-primary/30",
                isDragging && "opacity-50 z-50 shadow-2xl"
            )}
            style={{
                ...sortableStyle,
                borderLeftWidth: project.color ? '3px' : undefined,
                borderLeftColor: project.color || undefined,
            }}
            onClick={onOpen}
        >
            <button
                {...attributes} {...listeners}
                className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 opacity-60 hover:!opacity-100 transition-opacity touch-none"
                onClick={(e) => e.stopPropagation()}
            >
                <DotsSixVerticalIcon size={16} className="text-muted-foreground" />
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
            <ProjectMenu onRename={() => startEditing()} onDelete={onDelete} onColorChange={onColorChange} currentColor={project.color} />
        </div>
    )
}


// Shared dropdown menu
function ProjectMenu({ onRename, onDelete, onColorChange, currentColor }: {
    onRename: () => void
    onDelete: () => void
    onColorChange: (color: string | null) => void
    currentColor?: string | null
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 shrink-0"
                >
                    <DotsThreeVerticalIcon size={16} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onRename}>
                    <PencilSimpleIcon size={16} className="mr-2" /> Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
                    <PaletteIcon size={16} /> Color
                </DropdownMenuLabel>
                <div className="px-2 pb-1.5 pt-0.5">
                    <div className="flex items-center gap-1 flex-wrap">
                        <button
                            onClick={() => onColorChange(null)}
                            className={cn(
                                "h-5 w-5 rounded-full border-2 transition-all flex items-center justify-center",
                                !currentColor
                                    ? "border-foreground scale-110"
                                    : "border-muted-foreground/30 hover:border-muted-foreground/60"
                            )}
                            title="No color"
                        >
                            {!currentColor && <XIcon size={10} className="text-muted-foreground" />}
                        </button>
                        {PROJECT_COLORS.map((c) => (
                            <button
                                key={c.value}
                                onClick={() => onColorChange(c.value)}
                                className={cn(
                                    "h-5 w-5 rounded-full border-2 transition-all flex items-center justify-center",
                                    currentColor === c.value
                                        ? "border-foreground scale-110"
                                        : "border-transparent hover:scale-110"
                                )}
                                style={{ backgroundColor: c.value }}
                                title={c.label}
                            >
                                {currentColor === c.value && <CheckIcon size={10} className="text-white" />}
                            </button>
                        ))}
                    </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                    <TrashIcon size={16} className="mr-2" /> Delete
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
                        <XIcon size={16} />
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
            <PlusIcon size={24} />
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
                <PlusIcon size={16} className="text-muted-foreground shrink-0" />
                <input
                    ref={inputRef} type="text" placeholder="Project name..." value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setIsCreating(false); setName("") } }}
                    onBlur={handleCreate}
                    className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" className="h-7 text-xs" onClick={handleCreate}>Create</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setIsCreating(false); setName("") }}>
                    <XIcon size={16} />
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
            <PlusIcon size={16} />
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

    const colorMutation = useMutation({
        mutationFn: ({ id, color }: { id: string; color: string | null }) =>
            axios.patch(`http://localhost:8000/api/projects/${id}/color`, { color }).then((r) => r.data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    })

    const sortableIds = projects.map((p) => `project-${p.id}`)

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <SpinnerGapIcon size={24} className="animate-spin text-muted-foreground" />
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
                                onColorChange={(color) => colorMutation.mutate({ id: project.id, color })}
                            />
                        ))}
                        <NewProjectItem onCreate={(name) => createMutation.mutate(name)} />
                    </div>
                </SortableContext>
            </div>
        </div>
    )
}
