import { useState, useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2, UploadCloud, FileText, ArrowLeft, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Progress } from "@/components/ui/progress"
import { VoiceSelector } from "./VoiceSelector"
import { AudioPlayer } from "./AudioPlayer"
import { HistorySidebar } from "./HistorySidebar"
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
    const queryClient = useQueryClient()

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true)
        setProgress(0)
        setProgressText("Starting synthesis...")
        setError(null)

        try {
            const response = await fetch("http://localhost:8000/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, voice, speed: speed[0] }),
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
                        } else if (data.url) {
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
    }, [text, voice, speed, queryClient])

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
        setSelectedItem(item)
        setAudioUrl(`http://localhost:8000${item.url}`)
        setAudioFilename(item.filename)
        setShouldAutoplay(autoplay)
    }

    const handleBackToGenerator = () => {
        setSelectedItem(null)
    }

    return (
        <div className="flex w-full h-[calc(100vh-8rem)] gap-6">
            <div className="flex-1 min-w-0">
                <Card className="border-none shadow-2xl bg-card/80 backdrop-blur-xl h-full flex flex-col">
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
                                        "relative rounded-xl border-2 border-dashed transition-all duration-300 ease-in-out p-1 flex-shrink-0",
                                        isDragging ? "border-primary bg-primary/10 scale-[1.01]" : "border-muted-foreground/20 hover:border-primary/50"
                                    )}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                >
                                    <Textarea
                                        placeholder="Paste text here or drag & drop a PDF..."
                                        className="min-h-[200px] resize-y text-lg p-6 bg-transparent border-none focus-visible:ring-0"
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

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center flex-shrink-0">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Voice Model</Label>
                                            <VoiceSelector value={voice} onValueChange={setVoice} />
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <Label>Speed</Label>
                                                <span className="text-sm text-muted-foreground">{speed[0]}x</span>
                                            </div>
                                            <Slider
                                                value={speed}
                                                onValueChange={setSpeed}
                                                min={0.5}
                                                max={2.0}
                                                step={0.1}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-center md:justify-end">
                                        <Button
                                            size="lg"
                                            className="w-full md:w-auto min-w-[160px] text-lg h-12"
                                            onClick={handleGenerate}
                                            disabled={!text || isGenerating}
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
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                {isGenerating && (
                                    <div className="space-y-2 animate-in fade-in duration-300 flex-shrink-0">
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>{progressText}</span>
                                            <span>{progress}%</span>
                                        </div>
                                        <Progress value={progress} className="h-2" />
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
        </div>
    )
}
