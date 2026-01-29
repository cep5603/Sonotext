import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core"
import type { DragEndEvent } from "@dnd-kit/core"
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
    GripVertical,
    Play,
    Pause,
    Trash2,
    SquarePen,
    Check,
    X,
    Loader2,
    Mic,
    Palette,
    Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { VoiceProfile } from "@/types"

interface VoiceManagerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedProfileId: string | null
    onProfileSelect: (profileId: string | null) => void
    onCreateVoice: () => void
}

// Sortable voice item component
function SortableVoiceItem({
    profile,
    isSelected,
    onSelect,
    onRename,
    onDelete,
    onPreview,
    isPlaying,
    isRenaming,
}: {
    profile: VoiceProfile
    isSelected: boolean
    onSelect: () => void
    onRename: (name: string) => void
    onDelete: () => void
    onPreview: () => void
    isPlaying: boolean
    isRenaming: boolean
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
    } = useSortable({ id: profile.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const startEditing = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEditValue(profile.name)
        setIsEditing(true)
    }

    const confirmRename = () => {
        const trimmed = editValue.trim()
        if (trimmed && trimmed !== profile.name) {
            onRename(trimmed)
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

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "group flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all",
                isDragging && "opacity-50 shadow-lg",
                isSelected
                    ? "bg-primary/10 border-primary"
                    : "bg-card border-border hover:bg-muted/50"
            )}
        >
            {/* Drag handle */}
            <button
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-muted-foreground hover:text-foreground touch-none"
                aria-label="Reorder voice"
            >
                <GripVertical className="h-4 w-4" />
            </button>

            {/* Voice info */}
            <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={onSelect}
            >
                {isEditing ? (
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
                                "flex-1 min-w-0 bg-background border border-border rounded px-2 py-1",
                                "text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring",
                                isRenaming && "opacity-50"
                            )}
                        />
                        {isRenaming ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={confirmRename}
                                    className="p-1 hover:bg-accent rounded"
                                >
                                    <Check className="h-4 w-4 text-green-500" />
                                </button>
                                <button
                                    type="button"
                                    onClick={cancelEditing}
                                    className="p-1 hover:bg-accent rounded"
                                >
                                    <X className="h-4 w-4 text-muted-foreground" />
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-2">
                            {profile.source === "designed" ? (
                                <Palette className="h-4 w-4 shrink-0 text-purple-500" />
                            ) : (
                                <Mic className="h-4 w-4 shrink-0 text-blue-500" />
                            )}
                            <span className="font-medium truncate">{profile.name}</span>
                            {isSelected && (
                                <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                                    Selected
                                </span>
                            )}
                        </div>
                        {profile.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5 ml-6">
                                {profile.description}
                            </p>
                        )}
                    </>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                        e.stopPropagation()
                        onPreview()
                    }}
                    title="Preview voice"
                >
                    {isPlaying ? (
                        <Pause className="h-3.5 w-3.5" />
                    ) : (
                        <Play className="h-3.5 w-3.5" />
                    )}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={startEditing}
                    disabled={isEditing}
                    title="Rename"
                >
                    <SquarePen className="h-3.5 w-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                    }}
                    title="Delete"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    )
}

export function VoiceManagerDialog({
    open,
    onOpenChange,
    selectedProfileId,
    onProfileSelect,
    onCreateVoice,
}: VoiceManagerDialogProps) {
    const queryClient = useQueryClient()
    const [playingId, setPlayingId] = useState<string | null>(null)
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<VoiceProfile | null>(null)
    const audioRef = useRef<HTMLAudioElement>(null)

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const { data: profiles, isLoading } = useQuery({
        queryKey: ["voice-profiles"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/voice-profiles")
            return res.data.profiles as VoiceProfile[]
        },
    })

    const reorderMutation = useMutation({
        mutationFn: async (order: string[]) => {
            await axios.put("http://localhost:8000/api/voice-profiles/order", { order })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["voice-profiles"] })
        },
    })

    const renameMutation = useMutation({
        mutationFn: async ({ id, name }: { id: string; name: string }) => {
            const res = await axios.patch(`http://localhost:8000/api/voice-profiles/${id}`, { name })
            return res.data as VoiceProfile
        },
        onMutate: ({ id }) => {
            setRenamingId(id)
        },
        onSuccess: (updatedProfile) => {
            queryClient.setQueryData<VoiceProfile[]>(["voice-profiles"], (old) =>
                old?.map((p) => (p.id === updatedProfile.id ? updatedProfile : p))
            )
        },
        onSettled: () => {
            setRenamingId(null)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: async (profileId: string) => {
            await axios.delete(`http://localhost:8000/api/voice-profiles/${profileId}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["voice-profiles"] })
            if (deleteTarget && selectedProfileId === deleteTarget.id) {
                onProfileSelect(null)
            }
            setDeleteTarget(null)
        },
    })

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (over && active.id !== over.id && profiles) {
            const oldIndex = profiles.findIndex((p) => p.id === active.id)
            const newIndex = profiles.findIndex((p) => p.id === over.id)
            const newOrder = arrayMove(profiles, oldIndex, newIndex)

            // Optimistically update UI
            queryClient.setQueryData<VoiceProfile[]>(["voice-profiles"], newOrder)

            // Persist to backend
            reorderMutation.mutate(newOrder.map((p) => p.id))
        }
    }

    const handlePreview = (profileId: string) => {
        if (playingId === profileId) {
            // Stop playing
            audioRef.current?.pause()
            setPlayingId(null)
        } else {
            // Start playing
            if (audioRef.current) {
                audioRef.current.src = `http://localhost:8000/api/voice-profiles/${profileId}/reference-audio`
                audioRef.current.play()
                setPlayingId(profileId)
            }
        }
    }

    // Handle audio end
    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return

        const handleEnded = () => setPlayingId(null)
        audio.addEventListener("ended", handleEnded)
        return () => audio.removeEventListener("ended", handleEnded)
    }, [])

    // Stop audio when dialog closes
    useEffect(() => {
        if (!open) {
            audioRef.current?.pause()
            setPlayingId(null)
        }
    }, [open])

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader className="flex flex-row items-center justify-between gap-0 pr-8 mb-4">
                        <DialogTitle>Manage Custom Voices</DialogTitle>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                onOpenChange(false)
                                onCreateVoice()
                            }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Voice
                        </Button>
                    </DialogHeader>

                    {/* Voice list */}
                    <ScrollArea className="h-[50vh] pr-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : profiles && profiles.length > 0 ? (
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={profiles.map((p) => p.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-2">
                                        {profiles.map((profile) => (
                                            <SortableVoiceItem
                                                key={profile.id}
                                                profile={profile}
                                                isSelected={selectedProfileId === profile.id}
                                                onSelect={() => {
                                                    onProfileSelect(profile.id)
                                                    onOpenChange(false)
                                                }}
                                                onRename={(name) =>
                                                    renameMutation.mutate({ id: profile.id, name })
                                                }
                                                onDelete={() => setDeleteTarget(profile)}
                                                onPreview={() => handlePreview(profile.id)}
                                                isPlaying={playingId === profile.id}
                                                isRenaming={renamingId === profile.id}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                <p>No custom voices yet.</p>
                                <p className="text-sm mt-1">Click "Add Voice" to create one.</p>
                            </div>
                        )}
                    </ScrollArea>

                    {/* Hidden audio element */}
                    <audio ref={audioRef} className="hidden" />
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Voice Profile</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                        >
                            {deleteMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
