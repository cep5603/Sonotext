import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { DotsThreeVerticalIcon, PlayIcon, TrashIcon, DownloadSimpleIcon, ClockIcon, FolderOpenIcon, PencilSimpleIcon, SpinnerGapIcon, CheckIcon, XIcon, MagicWandIcon, WarningIcon, MagnifyingGlassIcon, FunnelIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useDraggable } from "@dnd-kit/core"
import { formatVoiceDisplay } from "@/lib/voiceData"
import type { HistoryItem, VoiceProfile, Project } from "@/types"

interface HistorySidebarProps {
    onSelectItem: (item: HistoryItem, autoplay?: boolean) => void
    activeDragId?: string | null
}

function formatDuration(seconds?: number): string {
    if (!seconds) return "--:--"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Display format: strip extension, UUID suffix, replace hyphens with spaces
function formatFilenameDisplay(filename: string): string {
    const basename = filename.split('/').pop() || filename
    return basename.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
}

// Edit format: strip extension and UUID suffix, keep hyphens
function formatFilenameEdit(filename: string): string {
    const basename = filename.split('/').pop() || filename
    return basename.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '')
}



// Normalize string for search: lowercase, strip punctuation/symbols, collapse whitespace
function normalizeForSearch(str: string): string {
    return str
        .toLowerCase()
        .replace(/[\p{P}\p{S}]/gu, "") // Unicode-aware punctuation & symbol removal
        .replace(/\s+/g, " ")
        .trim()
}

// Inline editable title component
function EditableTitle({
    item,
    onRename,
    onAutoRename,
    isRenaming,
    isAutoRenaming,
    hasAutoRenameError,
    llmAvailable,
}: {
    item: HistoryItem
    onRename: (id: string, name: string) => void
    onAutoRename: (id: string) => void
    isRenaming: boolean
    isAutoRenaming: boolean
    hasAutoRenameError: boolean
    llmAvailable: boolean
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const [isHovered, setIsHovered] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const displayName = formatFilenameDisplay(item.filename)
    const editName = formatFilenameEdit(item.filename)

    const startEditing = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEditValue(editName)
        setIsEditing(true)
    }

    const confirmRename = () => {
        const trimmed = editValue.trim()
        if (trimmed && trimmed !== editName) {
            onRename(item.id, trimmed)
        }
        setIsEditing(false)
    }

    const cancelEditing = () => {
        setIsEditing(false)
        setEditValue("")
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            confirmRename()
        } else if (e.key === "Escape") {
            cancelEditing()
        }
    }

    // Focus and select input when entering edit mode
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    if (isEditing) {
        return (
            <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
            >
                <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={confirmRename}
                    disabled={isRenaming}
                    className={cn(
                        "flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5",
                        "text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring",
                        isRenaming && "opacity-50"
                    )}
                />
                {isRenaming ? (
                    <SpinnerGapIcon size={16} className="animate-spin shrink-0 text-muted-foreground" />
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={confirmRename}
                            className="p-0.5 hover:bg-accent rounded shrink-0"
                        >
                            <CheckIcon size={16} className="text-green-500" />
                        </button>
                        <button
                            type="button"
                            onClick={cancelEditing}
                            className="p-0.5 hover:bg-accent rounded shrink-0"
                        >
                            <XIcon size={16} className="text-muted-foreground" />
                        </button>
                    </>
                )}
            </div>
        )
    }

    return (
        <div
            className="flex items-center gap-1 group/title"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <p
                className="text-sm font-medium leading-tight truncate flex-1"
                title={item.filename}
                onDoubleClick={startEditing}
            >
                {displayName}
            </p>
            {/* Auto-rename button */}
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation()
                    if (llmAvailable && !isAutoRenaming && !hasAutoRenameError) {
                        onAutoRename(item.id)
                    }
                }}
                disabled={!llmAvailable || isAutoRenaming}
                className={cn(
                    "p-0.5 rounded shrink-0 transition-all duration-200",
                    // Visibility
                    (isHovered || isAutoRenaming || hasAutoRenameError) ? "opacity-100" : "opacity-0",
                    // Disabled styling
                    !llmAvailable && "cursor-not-allowed",
                    // Error shake animation
                    hasAutoRenameError && "animate-shake"
                )}
                title={!llmAvailable ? "LLM not available" : hasAutoRenameError ? "Auto-rename failed" : "Auto-rename with AI"}
            >
                {isAutoRenaming ? (
                    <SpinnerGapIcon size={16} className="animate-spin text-muted-foreground" />
                ) : hasAutoRenameError ? (
                    <WarningIcon size={16} className="text-amber-500" />
                ) : (
                    <MagicWandIcon className={cn(
                        "h-3.5 w-3.5",
                        llmAvailable ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40"
                    )} />
                )}
            </button>
            {/* Manual rename button */}
            <button
                type="button"
                onClick={startEditing}
                className={cn(
                    "p-0.5 hover:bg-accent rounded shrink-0 transition-opacity",
                    isHovered ? "opacity-100" : "opacity-0"
                )}
                title="Rename"
            >
                <PencilSimpleIcon size={16} className="text-muted-foreground" />
            </button>
        </div>
    )
}

// Draggable wrapper for history cards  
function DraggableHistoryCard({ item, isDragging, children, onClick }: {
    item: HistoryItem
    isDragging: boolean
    children: React.ReactNode
    onClick: () => void
}) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: item.id,
        data: { type: "generation", item },
    })

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className={cn(
                "rounded-lg border border-border bg-background p-3 transition-all hover:bg-accent/50 cursor-pointer",
                isDragging && "opacity-30"
            )}
            onClick={onClick}
        >
            {children}
        </div>
    )
}

export function HistorySidebar({ onSelectItem, activeDragId }: HistorySidebarProps) {
    const queryClient = useQueryClient()
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [autoRenamingIds, setAutoRenamingIds] = useState<Set<string>>(new Set())
    const [autoRenameErrors, setAutoRenameErrors] = useState<Set<string>>(new Set())
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())

    // Query LLM availability
    const { data: llmStatus } = useQuery({
        queryKey: ["llm-status"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/llm-status")
            return res.data as { available: boolean }
        },
        refetchInterval: 30000, // Refresh every 30s
        staleTime: 10000,
    })
    const llmAvailable = llmStatus?.available ?? false

    const { data: history } = useQuery({
        queryKey: ["history"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/history")
            return res.data as HistoryItem[]
        },
    })

    // Fetch projects for filter
    const { data: projects = [] } = useQuery<Project[]>({
        queryKey: ["projects"],
        queryFn: () => axios.get("http://localhost:8000/api/projects").then((r) => r.data),
    })

    // Build set of generation IDs belonging to selected projects
    const selectedGenerationIds = useMemo(() => {
        if (selectedProjectIds.size === 0) return null // null = no filter
        const ids = new Set<string>()
        for (const project of projects) {
            if (selectedProjectIds.has(project.id)) {
                for (const gid of project.generation_ids) {
                    ids.add(gid)
                }
            }
        }
        return ids
    }, [selectedProjectIds, projects])

    // Fetch voice profiles for name resolution
    const { data: voiceProfiles } = useQuery({
        queryKey: ["voice-profiles"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/voice-profiles")
            return res.data.profiles as VoiceProfile[]
        },
    })

    // Build profile ID to name map for fast lookup
    const profileNameMap = useMemo(() => {
        const map = new Map<string, string>()
        voiceProfiles?.forEach((p) => map.set(p.id, p.name))
        return map
    }, [voiceProfiles])

    // Resolve voice display: check profile ID first, fallback to stored voice
    const getVoiceDisplayName = useCallback((item: HistoryItem) => {
        if (item.voice_profile_id) {
            const currentName = profileNameMap.get(item.voice_profile_id)
            if (currentName) return `🎤 ${currentName}`
        }
        return formatVoiceDisplay(item.voice, item.voice_profile_id)
    }, [profileNameMap])

    // Pre-calculate expensive string normalization for text search: O(Keystrokes * HistorySize) --> O(1 * HistorySize)
    const normalizedHistoryIndex = useMemo(() => {
        if (!history) return new Map<string, string>()

        const index = new Map<string, string>()
        for (const item of history) {
            const title = normalizeForSearch(formatFilenameDisplay(item.filename))
            const text = normalizeForSearch(item.text)
            const voice = normalizeForSearch(getVoiceDisplayName(item))
            const model = normalizeForSearch(item.model ?? "")
            // Concat all searchable fields w/ a delimiter for a single .includes() check
            index.set(item.id, `${title} | ${text} | ${voice} | ${model}`)
        }
        return index
    }, [history, getVoiceDisplayName])

    // Filter history based on search query + project filter (AND-composed)
    const filteredHistory = useMemo(() => {
        if (!history) return []

        let items = history

        // Project filter: keep items belonging to any selected project
        if (selectedGenerationIds) {
            items = items.filter((item) => selectedGenerationIds.has(item.id))
        }

        // Text search filter
        const normalizedQuery = normalizeForSearch(searchQuery)
        if (normalizedQuery) {
            items = items.filter((item) => {
                const searchableText = normalizedHistoryIndex.get(item.id)
                return searchableText ? searchableText.includes(normalizedQuery) : false
            })
        }

        return items
    }, [history, searchQuery, selectedGenerationIds, normalizedHistoryIndex])

    const toggleProject = useCallback((projectId: string) => {
        setSelectedProjectIds((prev) => {
            const next = new Set(prev)
            if (next.has(projectId)) {
                next.delete(projectId)
            } else {
                next.add(projectId)
            }
            return next
        })
    }, [])

    const clearProjectFilter = useCallback(() => {
        setSelectedProjectIds(new Set())
    }, [])

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await axios.delete(`http://localhost:8000/api/history/${id}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["history"] })
        },
    })

    const renameMutation = useMutation({
        mutationFn: async ({ id, name }: { id: string; name: string }) => {
            const res = await axios.post(`http://localhost:8000/api/history/${id}/rename`, { name })
            return res.data as HistoryItem
        },
        onMutate: ({ id }) => {
            setRenamingId(id)
        },
        onSuccess: (updatedItem) => {
            // Update the item in cache
            queryClient.setQueryData<HistoryItem[]>(["history"], (old) =>
                old?.map((item) => (item.id === updatedItem.id ? updatedItem : item))
            )
        },
        onSettled: () => {
            setRenamingId(null)
        },
    })

    const handleRename = (id: string, name: string) => {
        renameMutation.mutate({ id, name })
    }

    // Auto-rename mutation with concurrent request support
    const autoRenameMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await axios.post(`http://localhost:8000/api/history/${id}/auto-rename`)
            return res.data as HistoryItem
        },
        onMutate: (id) => {
            setAutoRenamingIds((prev) => new Set(prev).add(id))
            // Clear any previous error for this item
            setAutoRenameErrors((prev) => {
                const next = new Set(prev)
                next.delete(id)
                return next
            })
        },
        onSuccess: (updatedItem) => {
            queryClient.setQueryData<HistoryItem[]>(["history"], (old) =>
                old?.map((item) => (item.id === updatedItem.id ? updatedItem : item))
            )
        },
        onError: (_, id) => {
            // Show error state for 3 seconds
            setAutoRenameErrors((prev) => new Set(prev).add(id))
            setTimeout(() => {
                setAutoRenameErrors((prev) => {
                    const next = new Set(prev)
                    next.delete(id)
                    return next
                })
            }, 3000)
        },
        onSettled: (_, __, id) => {
            setAutoRenamingIds((prev) => {
                const next = new Set(prev)
                next.delete(id)
                return next
            })
        },
    })

    const handleAutoRename = (id: string) => {
        autoRenameMutation.mutate(id)
    }

    const handleShowInExplorer = async (filename: string) => {
        try {
            await axios.post("http://localhost:8000/api/show-in-explorer", { filename })
        } catch (e) {
            console.error("Failed to open explorer:", e)
        }
    }

    const filterCount = selectedProjectIds.size

    return (
        <div className="w-[26rem] border-l border-border bg-card/50 backdrop-blur-sm h-full flex flex-col shrink-0">
            <div className="p-4 border-b border-border shrink-0 flex items-center gap-3">
                <h2 className="font-semibold tracking-tight shrink-0">History</h2>
                <div className="relative flex-1">
                    <MagnifyingGlassIcon size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 pl-8 pr-8 text-sm"
                        aria-label="Search history"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-accent rounded"
                            aria-label="Clear search"
                        >
                            <XIcon size={16} className="text-muted-foreground" />
                        </button>
                    )}
                </div>
                {/* Project filter */}
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                "relative shrink-0 p-1.5 rounded-md transition-colors",
                                filterCount > 0
                                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                            aria-label={filterCount > 0 ? `Filter by project (${filterCount} active)` : "Filter by project"}
                            aria-haspopup="listbox"
                        >
                            <FunnelIcon size={20} weight={filterCount > 0 ? "fill" : "regular"} />
                            {filterCount > 0 && (
                                <span aria-hidden="true" className="absolute -top-1 -right-1 flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                                    {filterCount}
                                </span>
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-0">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                            <span id="filter-label" className="text-xs font-medium text-muted-foreground">Filter by Project</span>
                            {filterCount > 0 && (
                                <button
                                    type="button"
                                    onClick={clearProjectFilter}
                                    className="text-xs text-primary hover:underline"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div
                            role="listbox"
                            aria-labelledby="filter-label"
                            aria-multiselectable="true"
                            className="max-h-60 overflow-y-auto py-1"
                            onKeyDown={(e) => {
                                const items = Array.from(
                                    e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')
                                )
                                const idx = items.indexOf(e.target as HTMLElement)
                                if (idx === -1) return

                                let next = -1
                                if (e.key === "ArrowDown") {
                                    next = idx < items.length - 1 ? idx + 1 : 0
                                } else if (e.key === "ArrowUp") {
                                    next = idx > 0 ? idx - 1 : items.length - 1
                                } else if (e.key === "Home") {
                                    next = 0
                                } else if (e.key === "End") {
                                    next = items.length - 1
                                }

                                if (next !== -1) {
                                    e.preventDefault()
                                    items[next].focus()
                                }
                            }}
                        >
                            {projects.length === 0 ? (
                                <p className="px-3 py-4 text-xs text-muted-foreground text-center">No projects yet</p>
                            ) : (
                                projects.map((project) => {
                                    const isSelected = selectedProjectIds.has(project.id)
                                    return (
                                        <button
                                            key={project.id}
                                            type="button"
                                            role="option"
                                            aria-selected={isSelected}
                                            onClick={() => toggleProject(project.id)}
                                            className={cn(
                                                "flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-sm transition-colors",
                                                "hover:bg-accent focus-visible:bg-accent outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                                isSelected && "bg-accent/50"
                                            )}
                                        >
                                            <span
                                                className="flex-1 truncate font-medium"
                                                style={{ color: project.color || undefined }}
                                            >
                                                {project.name}
                                            </span>
                                            {isSelected && (
                                                <CheckIcon
                                                    size={14}
                                                    aria-hidden="true"
                                                    className="shrink-0"
                                                    style={{ color: project.color || "hsl(var(--primary))" }}
                                                />
                                            )}
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {filteredHistory.map((item) => {
                    return (
                        <DraggableHistoryCard key={item.id} item={item} isDragging={activeDragId === item.id} onClick={() => onSelectItem(item)}>
                            <div className="space-y-1.5">
                                {/* Editable filename */}
                                <EditableTitle
                                    item={item}
                                    onRename={handleRename}
                                    onAutoRename={handleAutoRename}
                                    isRenaming={renamingId === item.id}
                                    isAutoRenaming={autoRenamingIds.has(item.id)}
                                    hasAutoRenameError={autoRenameErrors.has(item.id)}
                                    llmAvailable={llmAvailable}
                                />
                                {/* Text preview in gray */}
                                <p className="text-xs text-muted-foreground leading-tight line-clamp-2 break-words" title={item.text}>
                                    {item.text || "No text"}
                                </p>
                                <div className="flex items-center text-xs text-muted-foreground gap-1.5 flex-wrap pt-1">
                                    <span>{getVoiceDisplayName(item)}</span>
                                    <span>•</span>
                                    <span>{item.speed}x</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1">
                                        <ClockIcon size={14} className="shrink-0" />
                                        {formatDuration(item.duration)}
                                    </span>
                                    <span>•</span>
                                    <span>{new Date(item.timestamp * 1000).toLocaleDateString()}</span>
                                </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="h-7 flex-1 text-xs"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onSelectItem(item, true)
                                    }}
                                >
                                    <PlayIcon size={16} className="mr-2" />
                                    Play
                                </Button>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                            <DotsThreeVerticalIcon size={16} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" side="left">
                                        <DropdownMenuItem onClick={() => handleShowInExplorer(item.filename)}>
                                            <FolderOpenIcon size={16} className="mr-2" /> Show in Explorer
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => {
                                            const a = document.createElement('a')
                                            a.href = `http://localhost:8000${item.url}`
                                            a.download = item.filename
                                            a.click()
                                        }}>
                                            <DownloadSimpleIcon size={16} className="mr-2" /> Download
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={() => deleteMutation.mutate(item.id)}
                                        >
                                            <TrashIcon size={16} className="mr-2" /> Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </DraggableHistoryCard>
                    )
                })}
                {filteredHistory.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-8">
                        {history?.length === 0
                            ? "No history yet. Generated audio will appear here."
                            : "No results match your search."}
                    </div>
                )}
            </div>
        </div>
    )
}
