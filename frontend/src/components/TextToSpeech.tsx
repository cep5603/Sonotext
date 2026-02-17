import { useState, useCallback, useRef, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { SpinnerGapIcon, FileArrowUpIcon, FileTextIcon, ArrowLeftIcon, ClockIcon, SparkleIcon, CaretDownIcon, ArrowsDownUpIcon, CopyIcon, CheckIcon } from "@phosphor-icons/react"
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
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import { AudioPlayer } from "./AudioPlayer"
import { SyncedTextView } from "./SyncedTextView"
import { HistorySidebar } from "./HistorySidebar"
import { SettingsSidebar } from "./SettingsSidebar"
import { ProjectsPanel } from "./ProjectsPanel"
import { ProjectDetailView } from "./ProjectDetailView"
import type { HistoryItem, WordTiming, Project } from "@/types"
import { cn } from "@/lib/utils"
import { formatVoiceDisplay } from "@/lib/voiceData"

function formatDuration(seconds?: number): string {
    if (!seconds) return "--:--"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}


interface TextToSpeechProps {
    selectedItem: HistoryItem | null
    onSelectedItemChange: (item: HistoryItem | null) => void
    resetToGeneratorToken: number
}

export function TextToSpeech({ selectedItem, onSelectedItemChange, resetToGeneratorToken }: TextToSpeechProps) {
    const [text, setText] = useState("")
    const [voice, setVoice] = useState("af_heart")
    const [lang, setLang] = useState<string | null>(null)  // null = auto-detect
    const [speed, setSpeed] = useState([1.0])
    const [engine, setEngine] = useState<"kokoro" | "qwen3">("kokoro")
    const [instruct, setInstruct] = useState("")  // Qwen3-TTS emotion/style instruction
    const [voiceProfileId, setVoiceProfileId] = useState<string | null>(null)  // Custom voice for cloning
    const [chunkSize, setChunkSize] = useState([500])  // Max chars per TTS chunk
    const [audioUrl, setAudioUrl] = useState<string | null>(null)
    const [audioFilename, setAudioFilename] = useState<string | undefined>(undefined)
    const [isDragging, setIsDragging] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [progressText, setProgressText] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [shouldAutoplay, setShouldAutoplay] = useState(false)
    // Text cleanup state
    const [isCleaning, setIsCleaning] = useState(false)
    const [cleanupProgress, setCleanupProgress] = useState(0)
    const [cleanupProgressText, setCleanupProgressText] = useState("")
    // Timing stats
    const [generationStats, setGenerationStats] = useState<{ totalSeconds: number; avgPerChunk: number } | null>(null)
    const [cleanupStats, setCleanupStats] = useState<{ totalSeconds: number; avgPerChunk: number } | null>(null)
    // Audio-text sync state
    const [alignmentData, setAlignmentData] = useState<WordTiming[] | null>(null)
    const [audioCurrentTime, setAudioCurrentTime] = useState(0)
    const [isAudioPlaying, setIsAudioPlaying] = useState(false)
    const [seekToTime, setSeekToTime] = useState<number | null>(null)
    const [autoScroll, setAutoScroll] = useState(true)
    const [copied, setCopied] = useState(false)
    const queryClient = useQueryClient()

    // View state
    type ViewMode = "generator" | "detail" | "projects" | "projectDetail"
    const [viewMode, setViewMode] = useState<ViewMode>(selectedItem ? "detail" : "generator")
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
    const [activeProjectName, setActiveProjectName] = useState<string | null>(null)
    const [activeProjectColor, setActiveProjectColor] = useState<string | null>(null)
    const [sourceProjectId, setSourceProjectId] = useState<string | null>(null) // which project the detail view came from
    const [activeDragId, setActiveDragId] = useState<string | null>(null)

    // Sync viewMode when selectedItem changes externally (e.g. from sidebar click)
    useEffect(() => {
        if (selectedItem && viewMode !== "detail") {
            setViewMode("detail")
            // If clicking from sidebar (not from a project), clear source project
            if (viewMode !== "projectDetail") {
                setSourceProjectId(null)
            }
        }
    }, [selectedItem])

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    )

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDragId(event.active.id as string)
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        setActiveDragId(null)
        const { active, over } = event
        if (!over) return

        const activeData = active.data.current as { type?: string } | undefined
        const overData = over.data.current as { type?: string; projectId?: string } | undefined

        // Case 1: Generation dropped on a project tile
        if (activeData?.type === "generation" && overData?.type === "project" && overData.projectId) {
            try {
                await axios.post(`http://localhost:8000/api/projects/${overData.projectId}/generations`, {
                    generation_id: active.id,
                })
                queryClient.invalidateQueries({ queryKey: ["projects"] })
                queryClient.invalidateQueries({ queryKey: ["projects", overData.projectId] })
            } catch (e) {
                console.error("Failed to add generation to project:", e)
            }
            return
        }

        // Case 2: Project tile reordered
        if (activeData?.type === "project" && overData?.type === "project" && active.id !== over.id) {
            // Get current project list from query cache
            const projects = queryClient.getQueryData<{ id: string }[]>(["projects"]) || []
            const activeId = (active.id as string).replace("project-", "")
            const overId = (over.id as string).replace("project-", "")
            const oldIndex = projects.findIndex((p) => p.id === activeId)
            const newIndex = projects.findIndex((p) => p.id === overId)
            if (oldIndex !== -1 && newIndex !== -1) {
                const reordered = arrayMove(projects, oldIndex, newIndex)
                // Optimistic update
                queryClient.setQueryData(["projects"], reordered)
                // Persist to backend
                try {
                    await axios.put("http://localhost:8000/api/projects/reorder", {
                        ordered_ids: reordered.map((p) => p.id),
                    })
                } catch (e) {
                    console.error("Failed to reorder projects:", e)
                    queryClient.invalidateQueries({ queryKey: ["projects"] })
                }
            }
            return
        }

        // Case 3: Generation reordered within a project
        if (activeData?.type === "project-generation" && overData?.type === "project-generation" && active.id !== over.id) {
            const activeGenData = active.data.current as { projectId?: string }
            const pid = activeGenData?.projectId
            if (pid) {
                const project = queryClient.getQueryData<{ generations: { id: string }[] }>(["projects", pid])
                if (project) {
                    const gens = project.generations
                    const activeGenId = (active.id as string).replace("project-gen-", "")
                    const overGenId = (over.id as string).replace("project-gen-", "")
                    const oldIndex = gens.findIndex((g) => g.id === activeGenId)
                    const newIndex = gens.findIndex((g) => g.id === overGenId)
                    if (oldIndex !== -1 && newIndex !== -1) {
                        const reordered = arrayMove(gens, oldIndex, newIndex)
                        // Optimistic update
                        queryClient.setQueryData(["projects", pid], { ...project, generations: reordered })
                        try {
                            await axios.put(`http://localhost:8000/api/projects/${pid}/generations/reorder`, {
                                ordered_ids: reordered.map((g) => g.id),
                            })
                        } catch (e) {
                            console.error("Failed to reorder generations:", e)
                            queryClient.invalidateQueries({ queryKey: ["projects", pid] })
                        }
                    }
                }
            }
            return
        }
    }

    // Navigation helpers
    const goToProjects = () => {
        onSelectedItemChange(null)
        setActiveProjectId(null)
        setActiveProjectName(null)
        setActiveProjectColor(null)
        setSourceProjectId(null)
        setViewMode("projects")
    }

    const goToProjectDetail = (project: Project) => {
        onSelectedItemChange(null)
        setActiveProjectId(project.id)
        setActiveProjectName(project.name)
        setActiveProjectColor(project.color || null)
        setSourceProjectId(null)
        setViewMode("projectDetail")
    }

    const goToGenerator = () => {
        onSelectedItemChange(null)
        setActiveProjectId(null)
        setActiveProjectName(null)
        setActiveProjectColor(null)
        setSourceProjectId(null)
        setViewMode("generator")
        setAlignmentData(null)
        setSeekToTime(null)
    }

    useEffect(() => {
        if (resetToGeneratorToken > 0) {
            goToGenerator()
        }
    }, [resetToGeneratorToken])

    // Switch to appropriate default voice when engine changes
    useEffect(() => {
        if (engine === "qwen3") {
            setVoice("aiden")
        } else {
            setVoice("af_heart")
        }
        // Reset language to auto since codes differ between engines
        setLang(null)
    }, [engine])

    // Update page title with progress percentage during generation
    useEffect(() => {
        if (isGenerating) {
            document.title = `${progress}% - Sonotext`
        } else {
            document.title = "Sonotext"
        }
    }, [isGenerating, progress])

    // Update page title with progress percentage during cleanup
    useEffect(() => {
        if (isCleaning) {
            document.title = `${cleanupProgress}% - Sonotext`
        } else {
            document.title = "Sonotext"
        }
    }, [isCleaning, cleanupProgress])

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
                body: JSON.stringify({
                    text,
                    voice,
                    speed: speed[0],
                    lang,
                    engine,
                    instruct: engine === "qwen3" && instruct ? instruct : null,
                    voice_profile_id: engine === "qwen3" && voiceProfileId ? voiceProfileId : null,
                    chunk_size: chunkSize[0],
                }),
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
                            const preview = data.chunk_preview ? ` — "${data.chunk_preview}..."` : ""
                            setProgressText(`Synthesizing chunk ${data.chunk} of ${data.total}${preview}`)
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
    }, [text, voice, lang, speed, engine, instruct, voiceProfileId, chunkSize, queryClient])

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

    const getProjectFromCache = (projectId: string) => {
        const directProject = queryClient.getQueryData<Project>(["projects", projectId])
        if (directProject) return directProject
        const projectList = queryClient.getQueryData<Project[]>(["projects"]) || []
        return projectList.find((project) => project.id === projectId)
    }

    const updateProjectBreadcrumbForSelection = (item: HistoryItem) => {
        const currentProjectId = sourceProjectId ?? activeProjectId
        if (!currentProjectId) {
            setSourceProjectId(null)
            return
        }

        const project = getProjectFromCache(currentProjectId)
        const isInProject = project?.generations?.some((generation) => generation.id === item.id)

        if (isInProject) {
            setSourceProjectId(currentProjectId)
        } else {
            setSourceProjectId(null)
        }
    }

    const handleSelectItem = (item: HistoryItem, autoplay: boolean = false) => {
        // If clicking Play on already-selected item, just trigger autoplay
        if (selectedItem?.id === item.id && autoplay) {
            setShouldAutoplay(true)
            return
        }
        updateProjectBreadcrumbForSelection(item)
        onSelectedItemChange(item)
        setAudioUrl(`http://localhost:8000${item.url}`)
        setAudioFilename(item.filename)
        setShouldAutoplay(autoplay)
        // Reset alignment state for new item
        setAlignmentData(null)
        setSeekToTime(null)
    }


    // Handle selecting a generation from project detail view
    const handleSelectFromProject = (item: HistoryItem, autoplay: boolean = false) => {
        setSourceProjectId(activeProjectId)
        handleSelectItem(item, autoplay)
    }

    // Fetch alignment data when a history item is selected
    useEffect(() => {
        if (!selectedItem) return

        const fetchAlignment = async () => {
            try {
                const response = await fetch(`http://localhost:8000/api/alignment/${selectedItem.id}`)
                if (response.ok) {
                    const data = await response.json()
                    setAlignmentData(data.words)
                }
            } catch (error) {
                console.error("Failed to fetch alignment:", error)
                // Silently fail - we'll just show plain text
            }
        }

        fetchAlignment()
    }, [selectedItem?.id])

    // Handle seek requests from SyncedTextView
    const handleSeek = useCallback((time: number) => {
        setSeekToTime(time)
        // Reset after a short delay to allow repeated seeks to the same time
        setTimeout(() => setSeekToTime(null), 100)
    }, [])

    return (
        <div className="flex w-full h-full">
            <SettingsSidebar
                voice={voice}
                onVoiceChange={setVoice}
                lang={lang}
                onLangChange={setLang}
                speed={speed}
                onSpeedChange={setSpeed}
                engine={engine}
                onEngineChange={setEngine}
                instruct={instruct}
                onInstructChange={setInstruct}
                voiceProfileId={voiceProfileId}
                onVoiceProfileChange={setVoiceProfileId}
                chunkSize={chunkSize}
                onChunkSizeChange={setChunkSize}
            />
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="flex-1 min-w-0 min-h-0 h-full px-8 py-4">
                    <Card className="border-none shadow-2xl bg-card/80 backdrop-blur-xl h-full flex flex-col max-w-4xl mx-auto">
                        <CardContent className="p-8 space-y-6 flex-1 flex flex-col overflow-hidden">

                            {/* Breadcrumb Navigation */}
                            <nav className="flex items-center gap-2 text-lg flex-wrap">
                                {/* Generator - always shown */}
                                {viewMode === "generator" ? (
                                    <>
                                        <span className="text-foreground font-medium">Generator</span>
                                        <span className="text-muted-foreground/50">/</span>
                                        <button
                                            onClick={goToProjects}
                                            className="text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            Projects
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={goToGenerator}
                                        className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                                    >
                                        <ArrowLeftIcon size={16} />
                                        Generator
                                    </button>
                                )}

                                {/* Projects */}
                                {(viewMode === "projects" || viewMode === "projectDetail" || (viewMode === "detail" && sourceProjectId)) && (
                                    <>
                                        <span className="text-muted-foreground/50">/</span>
                                        {viewMode === "projects" ? (
                                            <span className="text-foreground font-medium">Projects</span>
                                        ) : (
                                            <button
                                                onClick={goToProjects}
                                                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                                            >
                                                <ArrowLeftIcon size={16} />
                                                Projects
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Project Name */}
                                {(viewMode === "projectDetail" || (viewMode === "detail" && sourceProjectId)) && activeProjectName && (
                                    <>
                                        <span style={{ color: activeProjectColor || undefined }} className={activeProjectColor ? 'opacity-70' : 'text-muted-foreground/50'}>/</span>
                                        {viewMode === "projectDetail" ? (
                                            <span
                                                className="font-medium"
                                                style={{ color: activeProjectColor || undefined }}
                                            >
                                                {activeProjectName}
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    if (sourceProjectId) {
                                                        onSelectedItemChange(null)
                                                        setActiveProjectId(sourceProjectId)
                                                        setViewMode("projectDetail")
                                                        setSourceProjectId(null)
                                                    }
                                                }}
                                                className="hover:text-foreground transition-colors flex items-center gap-1"
                                            >
                                                <ArrowLeftIcon size={16} style={{ color: activeProjectColor || undefined }} />
                                                <span style={{ color: activeProjectColor || undefined }} className={activeProjectColor ? 'opacity-70' : 'text-muted-foreground'}>
                                                    {activeProjectName}
                                                </span>
                                            </button>
                                        )}
                                    </>
                                )}

                                {/* Current detail item name */}
                                {viewMode === "detail" && selectedItem && (
                                    <>
                                        <span className="text-muted-foreground/50">/</span>
                                        <span className="text-foreground font-medium truncate max-w-[400px]">
                                            {selectedItem.filename
                                                .split('/').pop()?.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
                                                || 'Untitled'}
                                        </span>
                                    </>
                                )}
                            </nav>

                            {/* Detail View - shows when a history item is selected */}
                            {viewMode === "detail" && selectedItem ? (
                                <div className="flex-1 flex flex-col space-y-4 animate-in fade-in duration-200 min-h-0">

                                    {/* Filename title */}
                                    <h2 className="text-xl font-semibold tracking-tight">
                                        {selectedItem.filename
                                            .split('/').pop()?.replace(/\.wav$/, '').replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')
                                            || 'Untitled'}
                                    </h2>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                            <span className="font-medium text-foreground">{formatVoiceDisplay(selectedItem.voice, selectedItem.voice_profile_id)}</span>
                                            {selectedItem.model && (
                                                <>
                                                    <span>•</span>
                                                    <span>{selectedItem.model}</span>
                                                </>
                                            )}
                                            <span>•</span>
                                            <span>{selectedItem.speed}x</span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1">
                                                <ClockIcon size={16} />
                                                {formatDuration(selectedItem.duration)}
                                            </span>
                                            <span>•</span>
                                            <span>{new Date(selectedItem.timestamp * 1000).toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={async () => {
                                                    await navigator.clipboard.writeText(selectedItem.text)
                                                    setCopied(true)
                                                    setTimeout(() => setCopied(false), 1500)
                                                }}
                                                className="gap-2 text-xs"
                                            >
                                                {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                                                {copied ? "Copied!" : "Copy"}
                                            </Button>
                                            <Button
                                                variant={autoScroll ? "secondary" : "ghost"}
                                                size="sm"
                                                onClick={() => setAutoScroll(!autoScroll)}
                                                className="gap-2 text-xs"
                                            >
                                                <ArrowsDownUpIcon size={16} />
                                                <span className="w-[5rem] text-left">{autoScroll ? "Auto-scroll On" : "Auto-scroll Off"}</span>
                                            </Button>
                                        </div>
                                    </div>

                                    <SyncedTextView
                                        text={selectedItem.text}
                                        alignmentData={alignmentData}
                                        currentTime={audioCurrentTime}
                                        onSeek={handleSeek}
                                        isPlaying={isAudioPlaying}
                                        autoScroll={autoScroll}
                                    />

                                    <AudioPlayer
                                        audioUrl={selectedItem.url.startsWith('http') ? selectedItem.url : `http://localhost:8000${selectedItem.url}`}
                                        filename={selectedItem.filename}
                                        autoplay={shouldAutoplay}
                                        onPlayStarted={() => setShouldAutoplay(false)}
                                        onTimeUpdate={setAudioCurrentTime}
                                        onPlayingChange={setIsAudioPlaying}
                                        seekToTime={seekToTime}
                                    />
                                </div>

                            ) : viewMode === "projects" ? (
                                /* Projects Grid View */
                                <ProjectsPanel onOpenProject={goToProjectDetail} />

                            ) : viewMode === "projectDetail" && activeProjectId ? (
                                /* Project Detail View */
                                <ProjectDetailView
                                    projectId={activeProjectId}
                                    projectColor={activeProjectColor}
                                    onSelectGeneration={handleSelectFromProject}
                                />

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
                                                    <FileArrowUpIcon size={48} className="mx-auto text-primary" />
                                                    <p className="text-lg font-medium text-primary">Drop PDF to extract text</p>
                                                </div>
                                            </div>
                                        )}

                                        {!text && !isDragging && (
                                            <div className="absolute bottom-4 right-4 text-xs text-muted-foreground flex items-center gap-2">
                                                <FileTextIcon size={16} />
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
                                        <div className="flex">
                                            <Button
                                                variant="secondary"
                                                size="lg"
                                                className="h-12 text-lg rounded-r-none"
                                                onClick={() => setText(text.replace(/[*#]/g, ''))}
                                                disabled={!text || isCleaning || isGenerating}
                                            >
                                                {isCleaning ? (
                                                    <>
                                                        <SpinnerGapIcon size={20} className="animate-spin mr-2" />
                                                        Cleaning...
                                                    </>
                                                ) : (
                                                    "Clean Text"
                                                )}
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="secondary"
                                                        size="lg"
                                                        className="h-12 px-2 rounded-l-none border-l border-secondary-foreground/20"
                                                        disabled={!text || isCleaning || isGenerating}
                                                    >
                                                        <CaretDownIcon size={16} />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={handleCleanText}>
                                                        <SparkleIcon size={16} className="mr-2" />
                                                        LLM Clean
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                        <div className="flex">
                                            <Button
                                                size="lg"
                                                className="min-w-[160px] text-lg h-12 rounded-r-none"
                                                onClick={handleGenerate}
                                                disabled={!text || isGenerating || isCleaning}
                                            >
                                                {isGenerating ? (
                                                    <>
                                                        <SpinnerGapIcon size={20} className="animate-spin mr-2" />
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
                                                        <CaretDownIcon size={16} />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={handleCleanAndGenerate}>
                                                        <SparkleIcon size={16} className="mr-2" />
                                                        LLM Clean & Generate
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
                                            <SpinnerGapIcon size={16} className="animate-spin" />
                                            <span>Extracting text from PDF...</span>
                                        </div>
                                    )}

                                    <AudioPlayer audioUrl={audioUrl} filename={audioFilename} />
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <HistorySidebar onSelectItem={handleSelectItem} activeDragId={activeDragId} />
                <DragOverlay>
                    {activeDragId && (
                        <div className="rounded-lg border border-primary bg-card px-3 py-2 shadow-xl text-sm font-medium opacity-90 max-w-[200px] truncate">
                            Moving item...
                        </div>
                    )}
                </DragOverlay>
            </DndContext >
        </div >
    )
}
