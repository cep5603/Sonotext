import { useState, useCallback, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2, UploadCloud, FileText, ArrowLeft, Clock, Sparkles, ChevronDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AudioPlayer } from "./AudioPlayer"
import { HistorySidebar } from "./HistorySidebar"
import { SettingsSidebar } from "./SettingsSidebar"
import type { HistoryItem } from "@/types"
import { cn } from "@/lib/utils"

function formatDuration(seconds?: number): string {
    if (!seconds) return "--:--"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function TextToSpeech() {
    const [text, setText] = useState("")
    const [voice, setVoice] = useState("af_sarah")
    const [lang, setLang] = useState<string | null>(null)  // null = auto-detect
    const [speed, setSpeed] = useState([1.0])
    const [audioUrl, setAudioUrl] = useState<string | null>(null)
    const [audioFilename, setAudioFilename] = useState<string | undefined>(undefined)
    const [isDragging, setIsDragging] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [progressText, setProgressText] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
    const [shouldAutoplay, setShouldAutoplay] = useState(false)
    // Text cleanup state
    const [isCleaning, setIsCleaning] = useState(false)
    const [cleanupProgress, setCleanupProgress] = useState(0)
    const [cleanupProgressText, setCleanupProgressText] = useState("")
    // Timing stats
    const [generationStats, setGenerationStats] = useState<{ totalSeconds: number; avgPerChunk: number } | null>(null)
    const [cleanupStats, setCleanupStats] = useState<{ totalSeconds: number; avgPerChunk: number } | null>(null)
    const queryClient = useQueryClient()

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true)
        setProgress(0)
        setProgressText("Starting synthesis...")
        setError(null)
        setGenerationStats(null)
        const startTime = performance.now()
        let totalChunks = 0

        try {
            const response = await fetch("http://localhost:8000/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, voice, speed: speed[0], lang }),
            })

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()

            if (!reader) throw new Error("No response body")

            let buffer = ""
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = JSON.parse(line.slice(6))

                        if (data.progress !== undefined) {
                            setProgress(data.progress)
                            setProgressText(`Synthesizing chunk ${data.chunk} of ${data.total}...`)
                            totalChunks = data.total
                        } else if (data.url) {
                            const endTime = performance.now()
                            const totalSeconds = (endTime - startTime) / 1000
                            setGenerationStats({
                                totalSeconds,
                                avgPerChunk: totalChunks > 0 ? totalSeconds / totalChunks : 0
                            })
                            setAudioUrl(`http://localhost:8000${data.url}`)
                            setAudioFilename(data.filename)
                            queryClient.invalidateQueries({ queryKey: ["history"] })
                            setProgress(100)
                            setProgressText("Complete!")
                        } else if (data.error) {
                            throw new Error(data.error)
                        }
                    }
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Generation failed")
        } finally {
            setIsGenerating(false)
        }
    }, [text, voice, lang, speed, queryClient])

    const handleCleanText = useCallback(async () => {
        setIsCleaning(true)
        setCleanupProgress(0)
        setCleanupProgressText("Starting cleanup...")
        setError(null)
        setCleanupStats(null)
        const startTime = performance.now()
        let totalChunks = 0

        try {
            const response = await fetch("http://localhost:8000/api/cleanup-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            })

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()

            if (!reader) throw new Error("No response body")

            let buffer = ""
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = JSON.parse(line.slice(6))

                        if (data.progress !== undefined) {
                            setCleanupProgress(data.progress)
                            setCleanupProgressText(`Cleaning chunk ${data.chunk} of ${data.total}...`)
                            totalChunks = data.total
                        } else if (data.text !== undefined) {
                            const endTime = performance.now()
                            const totalSeconds = (endTime - startTime) / 1000
                            setCleanupStats({
                                totalSeconds,
                                avgPerChunk: totalChunks > 0 ? totalSeconds / totalChunks : 0
                            })
                            setText(data.text)
                            setCleanupProgress(100)
                            setCleanupProgressText("Complete!")
                        } else if (data.error) {
                            throw new Error(data.error)
                        }
                    }
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Cleanup failed")
        } finally {
            setIsCleaning(false)
        }
    }, [text])

    // Ref to track if we should generate after cleaning
    const generateAfterCleanRef = useRef(false)

    const handleCleanAndGenerate = useCallback(async () => {
        generateAfterCleanRef.current = true
        await handleCleanText()
    }, [handleCleanText])

    // Effect to trigger generation after cleaning completes
    const prevIsCleaningRef = useRef(isCleaning)
    if (prevIsCleaningRef.current && !isCleaning && generateAfterCleanRef.current) {
        generateAfterCleanRef.current = false
        // Schedule generation for next tick to avoid state conflicts
        setTimeout(() => handleGenerate(), 0)
    }
    prevIsCleaningRef.current = isCleaning

    const pdfMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData()
            formData.append("file", file)
            const res = await axios.post("http://localhost:8000/api/parse-pdf", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            })
            return res.data.text
        },
        onSuccess: (extractedText) => {
            setText(prev => prev + (prev ? "\n\n" : "") + extractedText)
        },
    })

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        const files = Array.from(e.dataTransfer.files)
        const pdf = files.find(f => f.type === "application/pdf")
        if (pdf) {
            pdfMutation.mutate(pdf)
        }
    }, [pdfMutation])

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            pdfMutation.mutate(e.target.files[0])
        }
    }

    const handleSelectItem = (item: HistoryItem, autoplay: boolean = false) => {
        // If clicking Play on already-selected item, just trigger autoplay
        if (selectedItem?.id === item.id && autoplay) {
            setShouldAutoplay(true)
            return
        }
        setSelectedItem(item)
        setAudioUrl(`http://localhost:8000${item.url}`)
        setAudioFilename(item.filename)
        setShouldAutoplay(autoplay)
    }

    const handleBackToGenerator = () => {
        setSelectedItem(null)
    }

    return (
        <div className="flex w-full h-full">
            <SettingsSidebar
                voice={voice}
                onVoiceChange={setVoice}
                lang={lang}
                onLangChange={setLang}
                speed={speed}
                onSpeedChange={setSpeed}
            />
            <div className="flex-1 min-w-0 min-h-0 h-full px-8 py-4">
                <Card className="border-none shadow-2xl bg-card/80 backdrop-blur-xl h-full flex flex-col max-w-4xl mx-auto">
                    <CardContent className="p-8 space-y-6 flex-1 flex flex-col overflow-hidden">

                        {/* Detail View - shows when a history item is selected */}
                        {selectedItem ? (
                            <div className="flex-1 flex flex-col space-y-4 animate-in fade-in duration-200 min-h-0">
                                <div className="flex items-center gap-4">
                                    <Button variant="ghost" size="sm" onClick={handleBackToGenerator}>
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Back to Generator
                                    </Button>
                                </div>

                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    <span className="font-medium text-foreground">{selectedItem.voice}</span>
                                    <span>•</span>
                                    <span>{selectedItem.speed}x</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {formatDuration(selectedItem.duration)}
                                    </span>
                                    <span>•</span>
                                    <span>{new Date(selectedItem.timestamp * 1000).toLocaleString()}</span>
                                </div>

                                <div className="flex-1 min-h-0 rounded-lg border bg-muted/30 overflow-y-auto p-4">
                                    <p className="text-base leading-relaxed whitespace-pre-wrap">
                                        {selectedItem.text}
                                    </p>
                                </div>

                                <AudioPlayer audioUrl={audioUrl} filename={audioFilename} autoplay={shouldAutoplay} onPlayStarted={() => setShouldAutoplay(false)} />
                            </div>
                        ) : (
                            /* Generator View - normal text input and controls */
                            <>
                                <div
                                    className={cn(
                                        "relative rounded-xl border-2 border-dashed transition-all duration-300 ease-in-out p-1 flex-1 min-h-0 flex flex-col",
                                        isDragging ? "border-primary bg-primary/10 scale-[1.01]" : "border-muted-foreground/20 hover:border-primary/50"
                                    )}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                >
                                    <Textarea
                                        placeholder="Paste text here or drag & drop a PDF..."
                                        className="flex-1 min-h-0 resize-none text-lg p-6 bg-transparent border-none focus-visible:ring-0"
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                    />

                                    {isDragging && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl">
                                            <div className="text-center space-y-2 animate-bounce">
                                                <UploadCloud className="h-10 w-10 mx-auto text-primary" />
                                                <p className="text-lg font-medium text-primary">Drop PDF to extract text</p>
                                            </div>
                                        </div>
                                    )}

                                    {!text && !isDragging && (
                                        <div className="absolute bottom-4 right-4 text-xs text-muted-foreground flex items-center gap-2">
                                            <FileText className="h-3 w-3" />
                                            <span>Drag PDF or</span>
                                            <label className="cursor-pointer hover:text-primary underline">
                                                browse
                                                <input type="file" accept=".pdf" className="hidden" onChange={handleFileSelect} />
                                            </label>
                                        </div>
                                    )}
                                </div>

                                {/* Cleanup Progress Bar */}
                                {(isCleaning || cleanupStats) && (
                                    <div className="space-y-2 animate-in fade-in duration-300 flex-shrink-0">
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>{cleanupProgressText}</span>
                                            <span>{cleanupProgress}%</span>
                                        </div>
                                        <Progress value={cleanupProgress} className="h-2" />
                                        {cleanupStats && !isCleaning && (
                                            <div className="text-xs text-muted-foreground text-right">
                                                {cleanupStats.totalSeconds.toFixed(2)}s total • {cleanupStats.avgPerChunk.toFixed(2)}s/chunk
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-end gap-3 flex-shrink-0">
                                    <Button
                                        variant="secondary"
                                        size="lg"
                                        className="h-12"
                                        onClick={handleCleanText}
                                        disabled={!text || isCleaning || isGenerating}
                                    >
                                        {isCleaning ? (
                                            <>
                                                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                                Cleaning...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles className="h-5 w-5 mr-2" />
                                                Clean Text
                                            </>
                                        )}
                                    </Button>
                                    <div className="flex">
                                        <Button
                                            size="lg"
                                            className="min-w-[160px] text-lg h-12 rounded-r-none"
                                            onClick={handleGenerate}
                                            disabled={!text || isGenerating || isCleaning}
                                        >
                                            {isGenerating ? (
                                                <>
                                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                                    Synthesizing...
                                                </>
                                            ) : (
                                                "Generate Audio"
                                            )}
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    size="lg"
                                                    className="h-12 px-2 rounded-l-none border-l border-primary-foreground/20"
                                                    disabled={!text || isGenerating || isCleaning}
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={handleCleanAndGenerate}>
                                                    <Sparkles className="mr-2 h-4 w-4" />
                                                    Clean & Generate
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                {(isGenerating || generationStats) && (
                                    <div className="space-y-2 animate-in fade-in duration-300 flex-shrink-0">
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>{progressText}</span>
                                            <span>{progress}%</span>
                                        </div>
                                        <Progress value={progress} className="h-2" />
                                        {generationStats && !isGenerating && (
                                            <div className="text-xs text-muted-foreground text-right">
                                                {generationStats.totalSeconds.toFixed(2)}s total • {generationStats.avgPerChunk.toFixed(2)}s/chunk
                                            </div>
                                        )}
                                    </div>
                                )}

                                {error && (
                                    <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm text-center flex-shrink-0">
                                        {error}
                                    </div>
                                )}

                                {pdfMutation.isPending && (
                                    <div className="flex items-center justify-center gap-2 text-muted-foreground animate-pulse flex-shrink-0">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>Extracting text from PDF...</span>
                                    </div>
                                )}

                                <AudioPlayer audioUrl={audioUrl} filename={audioFilename} />
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            <HistorySidebar onSelectItem={handleSelectItem} />
        </div >
    )
}
