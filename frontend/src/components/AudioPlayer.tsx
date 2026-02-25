import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react"
import WaveSurfer from "wavesurfer.js"
import { PlayIcon, PauseIcon, DownloadSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

interface AudioPlayerProps {
    audioUrl: string | null
    filename?: string
    autoplay?: boolean
    onPlayStarted?: () => void
    onTimeUpdate?: (time: number) => void
    onPlayingChange?: (isPlaying: boolean) => void
    seekToTime?: number | null
    accentColor?: string | null
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

const TIME_UPDATE_INTERVAL_MS = 100

const DEFAULT_ACCENT = 'rgb(101, 165, 255)'

export interface AudioPlayerHandle {
    togglePlay: () => void
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({
    audioUrl,
    filename,
    autoplay,
    onPlayStarted,
    onTimeUpdate,
    onPlayingChange,
    seekToTime,
    accentColor
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<WaveSurfer | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [isReady, setIsReady] = useState(false)

    useImperativeHandle(ref, () => ({
        togglePlay: () => wavesurferRef.current?.playPause(),
    }))

    // Track autoplay intent - we only autoplay on initial load or when autoplay prop changes to true
    const autoplayRef = useRef(autoplay)
    const onPlayStartedRef = useRef(onPlayStarted)
    const currentLoadedUrl = useRef<string | null>(null)
    // Refs for direct callback invocation (avoids useEffect intermediary)
    const onTimeUpdateRef = useRef(onTimeUpdate)
    const onPlayingChangeRef = useRef(onPlayingChange)
    const rafIdRef = useRef<number | null>(null)
    const isPollingRef = useRef(false)
    const lastTimeUpdateRef = useRef(0)

    const stopPolling = () => {
        isPollingRef.current = false
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current)
            rafIdRef.current = null
        }
    }

    const emitCurrentTime = (ws: WaveSurfer) => {
        const t = ws.getCurrentTime()
        setCurrentTime(t)
        onTimeUpdateRef.current?.(t)
    }

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
            stopPolling()
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
            progressColor: accentColor || DEFAULT_ACCENT,
            cursorColor: accentColor || DEFAULT_ACCENT,
            barWidth: 2,
            barGap: 1,
            height: 60,
        })

        wavesurferRef.current = ws

        ws.on('play', () => {
            setIsPlaying(true)
            onPlayingChangeRef.current?.(true)

            if (isPollingRef.current) {
                return
            }

            isPollingRef.current = true
            lastTimeUpdateRef.current = 0

            // Start rAF polling for smooth time updates
            const poll = () => {
                if (!isPollingRef.current) {
                    return
                }

                // Stop if this instance is no longer current or playback has stopped
                if (wavesurferRef.current !== ws || !ws.isPlaying()) {
                    stopPolling()
                    return
                }

                const now = performance.now()
                if (now - lastTimeUpdateRef.current >= TIME_UPDATE_INTERVAL_MS) {
                    emitCurrentTime(ws)
                    lastTimeUpdateRef.current = now
                }

                rafIdRef.current = requestAnimationFrame(poll)
            }

            rafIdRef.current = requestAnimationFrame(poll)
        })
        ws.on('pause', () => {
            setIsPlaying(false)
            onPlayingChangeRef.current?.(false)
            stopPolling()
        })
        ws.on('finish', () => {
            setIsPlaying(false)
            onPlayingChangeRef.current?.(false)
            stopPolling()
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
            emitCurrentTime(ws)
        })

        // Load the audio - catch AbortError which happens when component unmounts during load
        ws.load(audioUrl).catch((e) => {
            if (e instanceof Error && e.name === 'AbortError') return
            console.error("WaveSurfer load error:", e)
        })

        // Cleanup on unmount or URL change
        return () => {
            stopPolling()
            ws.destroy()
            wavesurferRef.current = null
        }
    }, [audioUrl])

    // Update wavesurfer colors when accentColor changes
    useEffect(() => {
        if (!wavesurferRef.current) return
        const color = accentColor || DEFAULT_ACCENT
        wavesurferRef.current.setOptions({
            progressColor: color,
            cursorColor: color,
        })
    }, [accentColor])

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
            const seekRatio = duration > 0 ? Math.min(Math.max(seekToTime / duration, 0), 1) : 0
            wavesurferRef.current.seekTo(seekRatio)
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
        <div className="w-full space-y-2 rounded-lg border bg-card/30 p-4 animate-in fade-in zoom-in-95 duration-300">
            {/* Filename display */}
            {filename && (
                <div className="text-sm font-medium text-muted-foreground truncate">
                    {filename}
                </div>
            )}

            {/* Waveform */}
            <div ref={containerRef} className="w-full" />

            {/* Time display */}
            <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
            </div>

            {/* Controls */}
            <div className="flex justify-center gap-4">
                <Button variant="outline" size="icon" onClick={togglePlay} disabled={!isReady}>
                    {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                </Button>
                <Button variant="outline" size="icon" onClick={handleDownload}>
                    <DownloadSimpleIcon size={16} />
                </Button>
            </div>
        </div>
    )
})
