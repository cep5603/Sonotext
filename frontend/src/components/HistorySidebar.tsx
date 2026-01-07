import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { MoreVertical, Play, Trash2, Download, Clock, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

function formatFilename(filename: string): string {
    // Remove extension and UUID suffix for display
    return filename.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
}

export function HistorySidebar({ onSelectItem }: HistorySidebarProps) {
    const queryClient = useQueryClient()

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
                <h2 className="font-semibold tracking-tight">History</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {history?.map((item) => (
                    <div
                        key={item.id}
                        className="rounded-lg border border-border bg-background p-3 transition-all hover:bg-accent/50 cursor-pointer"
                        onClick={() => onSelectItem(item)}
                    >
                        <div className="space-y-1.5">
                            {/* Filename as title */}
                            <p className="text-sm font-medium leading-tight truncate" title={item.filename}>
                                {formatFilename(item.filename)}
                            </p>
                            {/* Text preview in gray */}
                            <p className="text-xs text-muted-foreground leading-tight line-clamp-2 break-words" title={item.text}>
                                {item.text || "No text"}
                            </p>
                            <div className="flex items-center text-xs text-muted-foreground gap-1.5 flex-wrap pt-1">
                                <span>{item.voice}</span>
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
