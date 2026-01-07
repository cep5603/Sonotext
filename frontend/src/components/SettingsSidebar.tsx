import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { VoiceSelector } from "./VoiceSelector"
import { LLMModelSelector } from "./LLMModelSelector"

interface SettingsSidebarProps {
    voice: string
    onVoiceChange: (voice: string) => void
    speed: number[]
    onSpeedChange: (speed: number[]) => void
}

export function SettingsSidebar({
    voice,
    onVoiceChange,
    speed,
    onSpeedChange,
}: SettingsSidebarProps) {
    return (
        <div className="w-64 border-r border-border bg-card/50 backdrop-blur-sm h-full flex flex-col shrink-0">
            <div className="p-4 border-b border-border shrink-0">
                <h2 className="font-semibold tracking-tight">Settings</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Voice Synthesis Settings */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Voice Model</Label>
                        <VoiceSelector value={voice} onValueChange={onVoiceChange} />
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Speed</Label>
                            <span className="text-sm text-muted-foreground">{speed[0]}x</span>
                        </div>
                        <Slider
                            value={speed}
                            onValueChange={onSpeedChange}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                        />
                    </div>
                </div>

                {/* Separator */}
                <div className="border-t border-border" />

                {/* Text Processing Settings */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Text Model</Label>
                        <LLMModelSelector />
                    </div>
                </div>
            </div>
        </div>
    )
}
