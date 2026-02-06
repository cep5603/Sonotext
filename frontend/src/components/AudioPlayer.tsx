import { useEffect, useRef, useState } from "react"
import WaveSurfer from "wavesurfer.js"
import { Play, Pause, Download } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AudioPlayerProps {
    audioUrl: string | null
    filename?: string
    autoplay?: boolean
    onPlayStarted?: () => void
    onTimeUpdate?: (time: number) => void
    onPlayingChange?: (isPlaying: boolean) => void
    seekToTime?: number | null
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioPlayer({
    audioUrl,
    filename,
    autoplay,
    onPlayStarted,
    onTimeUpdate,
    onPlayingChange,
    seekToTime
}: AudioPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<WaveSurfer | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [isReady, setIsReady] = useState(false)

    // Track autoplay intent - we only autoplay on initial load or when autoplay prop changes to true
    const autoplayRef = useRef(autoplay)
    const onPlayStartedRef = useRef(onPlayStarted)
    const currentLoadedUrl = useRef<string | null>(null)
    // Refs for direct callback invocation (avoids useEffect intermediary)
    const onTimeUpdateRef = useRef(onTimeUpdate)
    const onPlayingChangeRef = useRef(onPlayingChange)
    const rafIdRef = useRef<number | null>(null)

    // Keep callback refs in sync
    useEffect(() => {
        autoplayRef.current = autoplay
    }, [autoplay])

    useEffect(() => {
        onPlayStartedRef.current = onPlayStarted
    }, [onPlayStarted])

    useEffect(() => {
        onTimeUpdateRef.current = onTimeUpdate
    }, [onTimeUpdate])

    useEffect(() => {
        onPlayingChangeRef.current = onPlayingChange
    }, [onPlayingChange])

    // Main effect: Initialize WaveSurfer and load audio when audioUrl changes
    useEffect(() => {
        if (!containerRef.current || !audioUrl) return

        // If we already have WaveSurfer and it's the same URL, skip
        if (wavesurferRef.current && currentLoadedUrl.current === audioUrl) {
            return
        }

        // Cleanup previous instance if exists
        if (wavesurferRef.current) {
            wavesurferRef.current.destroy()
            wavesurferRef.current = null
        }

        // Reset state
        setIsPlaying(false)
        setCurrentTime(0)
        setDuration(0)
        setIsReady(false)
        currentLoadedUrl.current = audioUrl

        // Create new WaveSurfer instance
        const ws = WaveSurfer.create({
            container: containerRef.current,
            waveColor: 'rgb(200, 200, 200)',
            progressColor: 'rgb(101, 165, 255)',
            cursorColor: 'rgb(101, 165, 255)',
            barWidth: 2,
            barGap: 1,
            height: 80,
        })

        wavesurferRef.current = ws

        ws.on('play', () => {
            setIsPlaying(true)
            onPlayingChangeRef.current?.(true)
            // Start rAF polling for smooth time updates
            const poll = () => {
                if (wavesurferRef.current) {
                    const t = wavesurferRef.current.getCurrentTime()
                    setCurrentTime(t)
                    onTimeUpdateRef.current?.(t)
                }
                rafIdRef.current = requestAnimationFrame(poll)
            }
            rafIdRef.current = requestAnimationFrame(poll)
        })
        ws.on('pause', () => {
            setIsPlaying(false)
            onPlayingChangeRef.current?.(false)
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current)
                rafIdRef.current = null
            }
        })
        ws.on('finish', () => {
            setIsPlaying(false)
            onPlayingChangeRef.current?.(false)
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current)
                rafIdRef.current = null
            }
        })
        ws.on('error', (e) => {
            // Ignore abort errors - they're expected when component unmounts during load
            if (e instanceof Error && e.name === 'AbortError') {
                return
            }
            console.error("WaveSurfer Error:", e)
        })

        ws.on('ready', () => {
            setDuration(ws.getDuration())
            setIsReady(true)

            // Handle autoplay after load
            if (autoplayRef.current) {
                ws.play()
                onPlayStartedRef.current?.()
            }
        })

        ws.on('seeking', () => {
            const t = ws.getCurrentTime()
            setCurrentTime(t)
            onTimeUpdateRef.current?.(t)
        })

        // Load the audio - catch AbortError which happens when component unmounts during load
        ws.load(audioUrl).catch((e) => {
            if (e instanceof Error && e.name === 'AbortError') return
            console.error("WaveSurfer load error:", e)
        })

        // Cleanup on unmount or URL change
        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current)
                rafIdRef.current = null
            }
            ws.destroy()
            wavesurferRef.current = null
        }
    }, [audioUrl])

    // Handle autoplay prop changes for already-loaded audio
    useEffect(() => {
        if (autoplay && wavesurferRef.current && isReady && !isPlaying) {
            wavesurferRef.current.play()
            onPlayStarted?.()
        }
    }, [autoplay, isReady, isPlaying, onPlayStarted])


    // Handle external seek requests
    useEffect(() => {
        if (seekToTime !== null && seekToTime !== undefined && wavesurferRef.current && isReady) {
            wavesurferRef.current.seekTo(seekToTime / duration)
        }
    }, [seekToTime, duration, isReady])

    const togglePlay = () => {
        wavesurferRef.current?.playPause()
    }

    const handleDownload = () => {
        if (!audioUrl) return
        const a = document.createElement('a')
        a.href = audioUrl
        a.download = filename || 'generated-audio.wav'
        a.click()
    }

    if (!audioUrl) return null

    return (
        <div className="w-full space-y-4 rounded-lg border bg-card p-4 animate-in fade-in zoom-in-95 duration-300">
            {/* Filename display */}
            {filename && (
                <div className="text-sm font-medium text-muted-foreground truncate">
                    {filename}
                </div>
            )}

            {/* Waveform */}
            <div ref={containerRef} className="w-full" />

            {/* Time display */}
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
            </div>

            {/* Controls */}
            <div className="flex justify-center gap-4">
                <Button variant="outline" size="icon" onClick={togglePlay} disabled={!isReady}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={handleDownload}>
                    <Download className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
