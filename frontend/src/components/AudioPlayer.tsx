import { useEffect, useRef, useState } from "react"
import WaveSurfer from "wavesurfer.js"
import { Play, Pause, Download } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AudioPlayerProps {
    audioUrl: string | null
    filename?: string
    autoplay?: boolean
    onPlayStarted?: () => void
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioPlayer({ audioUrl, filename, autoplay, onPlayStarted }: AudioPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<WaveSurfer | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    // Use refs for values needed in event handlers to avoid stale closures
    const autoplayRef = useRef(autoplay)
    const onPlayStartedRef = useRef(onPlayStarted)

    // Keep refs in sync with props
    useEffect(() => {
        autoplayRef.current = autoplay
    }, [autoplay])

    useEffect(() => {
        onPlayStartedRef.current = onPlayStarted
    }, [onPlayStarted])

    // Initialize WaveSurfer once
    useEffect(() => {
        if (!containerRef.current) return
        if (wavesurferRef.current) return

        try {
            wavesurferRef.current = WaveSurfer.create({
                container: containerRef.current,
                waveColor: 'rgb(200, 200, 200)',
                progressColor: 'rgb(100, 100, 255)',
                cursorColor: 'rgb(100, 100, 255)',
                barWidth: 2,
                barGap: 1,
                height: 80,
            })

            wavesurferRef.current.on('play', () => setIsPlaying(true))
            wavesurferRef.current.on('pause', () => setIsPlaying(false))
            wavesurferRef.current.on('finish', () => setIsPlaying(false))
            wavesurferRef.current.on('error', (e) => console.error("WaveSurfer Error:", e))

            wavesurferRef.current.on('ready', () => {
                setDuration(wavesurferRef.current?.getDuration() ?? 0)
                // Handle autoplay after load - check ref for latest value
                if (autoplayRef.current) {
                    wavesurferRef.current?.play()
                    onPlayStartedRef.current?.()
                }
            })

            wavesurferRef.current.on('audioprocess', () => {
                setCurrentTime(wavesurferRef.current?.getCurrentTime() ?? 0)
            })

            wavesurferRef.current.on('seeking', () => {
                setCurrentTime(wavesurferRef.current?.getCurrentTime() ?? 0)
            })
        } catch (err) {
            console.error("AudioPlayer: Init Failed", err)
        }

        return () => {
            wavesurferRef.current?.destroy()
            wavesurferRef.current = null
        }
    }, []) // Empty deps - init once

    // Handle URL changes
    useEffect(() => {
        if (audioUrl && wavesurferRef.current) {
            // Stop any current playback and reset state before loading new audio
            if (wavesurferRef.current.isPlaying()) {
                wavesurferRef.current.stop()
            }
            setIsPlaying(false)
            setCurrentTime(0)
            setDuration(0)
            wavesurferRef.current.load(audioUrl)
        }
    }, [audioUrl])

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
                <Button variant="outline" size="icon" onClick={togglePlay}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={handleDownload}>
                    <Download className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
