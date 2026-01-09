import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { MoreVertical, Play, Trash2, Download, Clock, FolderOpen, SquarePen, Loader2, Check, X, Wand2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { getVoiceInfo, getVoiceLanguage } from "@/lib/voiceData"
import type { HistoryItem } from "@/types"

interface HistorySidebarProps {
    onSelectItem: (item: HistoryItem, autoplay?: boolean) => void
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

// Format voice display: flag + capitalized name (e.g. "🇫🇷 Siwis")
function formatVoiceDisplay(voiceId: string): string {
    const voice = getVoiceInfo(voiceId)
    const lang = getVoiceLanguage(voiceId)
    if (voice && lang) {
        return `${lang.flag} ${voice.name}`
    }
    return voiceId // Fallback to raw ID
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
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={confirmRename}
                            className="p-0.5 hover:bg-accent rounded shrink-0"
                        >
                            <Check className="h-3.5 w-3.5 text-green-500" />
                        </button>
                        <button
                            type="button"
                            onClick={cancelEditing}
                            className="p-0.5 hover:bg-accent rounded shrink-0"
                        >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
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
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : hasAutoRenameError ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                ) : (
                    <Wand2 className={cn(
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
                <SquarePen className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
        </div>
    )
}

export function HistorySidebar({ onSelectItem }: HistorySidebarProps) {
    const queryClient = useQueryClient()
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [autoRenamingIds, setAutoRenamingIds] = useState<Set<string>>(new Set())
    const [autoRenameErrors, setAutoRenameErrors] = useState<Set<string>>(new Set())

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

    return (
        <div className="w-[26rem] border-l border-border bg-card/50 backdrop-blur-sm h-full flex flex-col shrink-0">
            <div className="p-4 border-b border-border shrink-0">
                <h2 className="font-semibold tracking-tight">Generation History</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {history?.map((item) => (
                    <div
                        key={item.id}
                        className="rounded-lg border border-border bg-background p-3 transition-all hover:bg-accent/50 cursor-pointer"
                        onClick={() => onSelectItem(item)}
                    >
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
                                <span>{formatVoiceDisplay(item.voice)}</span>
                                <span>•</span>
                                <span>{item.speed}x</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3 shrink-0" />
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
                                    <DropdownMenuItem onClick={() => handleShowInExplorer(item.filename)}>
                                        <FolderOpen className="mr-2 h-3 w-3" /> Show in Explorer
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => {
                                        const a = document.createElement('a')
                                        a.href = `http://localhost:8000${item.url}`
                                        a.download = item.filename
                                        a.click()
                                    }}>
                                        <Download className="mr-2 h-3 w-3" /> Download
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => deleteMutation.mutate(item.id)}
                                    >
                                        <Trash2 className="mr-2 h-3 w-3" /> Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                ))}
                {history?.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-8">
                        No history yet. Generated audio will appear here.
                    </div>
                )}
            </div>
        </div>
    )
}
