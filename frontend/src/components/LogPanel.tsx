import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { apiUrl } from "@/lib/api"

type LogPanelProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function LogPanel({ open, onOpenChange }: LogPanelProps) {
    const [logs, setLogs] = useState("")
    const [isConnected, setIsConnected] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const logRef = useRef<HTMLPreElement | null>(null)

    useEffect(() => {
        if (!open) {
            return
        }

        setError(null)
        const eventSource = new EventSource(apiUrl("/api/logs"))

        eventSource.addEventListener("open", () => {
            setIsConnected(true)
            setError(null)
        })

        eventSource.addEventListener("logs", (event) => {
            try {
                const data = JSON.parse(event.data) as { chunk?: string }
                if (data.chunk) {
                    setLogs((current) => `${current}${data.chunk}`.slice(-250_000))
                }
            } catch {
                setLogs((current) => `${current}${event.data}\n`.slice(-250_000))
            }
        })

        eventSource.onerror = () => {
            setIsConnected(false)
            setError("Waiting for log stream...")
        }

        return () => {
            eventSource.close()
            setIsConnected(false)
        }
    }, [open])

    useEffect(() => {
        if (open && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight
        }
    }, [logs, open])

    const statusText = useMemo(() => {
        if (isConnected) {
            return "Connected"
        }
        return error ?? "Disconnected"
    }, [error, isConnected])

    const copyLogs = useCallback(async () => {
        if (logs) {
            await navigator.clipboard.writeText(logs)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
        }
    }, [logs])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[min(760px,calc(100vh-2rem))] max-w-[min(1400px,calc(100vw-2rem))] flex-col border-border/80 bg-background/95 p-0 shadow-2xl backdrop-blur">
                <DialogHeader className="border-b border-border/70 px-5 py-4">
                    <DialogTitle>Sonotext Logs</DialogTitle>
                    <DialogDescription className="flex items-center gap-2">
                        <span className={isConnected ? "text-emerald-400" : "text-amber-400"}>{statusText}</span>
                        <span>Streaming from the local backend log file.</span>
                    </DialogDescription>
                </DialogHeader>

                <pre
                    ref={logRef}
                    className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-black/50 px-5 py-4 font-mono text-xs leading-relaxed text-zinc-100"
                >
                    {logs || "No log output yet."}
                </pre>

                <DialogFooter className="border-t border-border/70 px-5 py-4 sm:justify-between">
                    <Button variant="ghost" onClick={() => setLogs("")}>
                        <TrashIcon size={16} className="mr-2" />
                        Clear View
                    </Button>
                    <Button variant="secondary" onClick={copyLogs} disabled={!logs}>
                        {copied ? <CheckIcon size={16} className="mr-2" /> : <CopyIcon size={16} className="mr-2" />}
                        {copied ? "Copied!" : "Copy Logs"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
