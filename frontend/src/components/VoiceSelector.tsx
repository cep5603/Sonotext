import { useState, useMemo } from "react"
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { VOICE_DATA, getVoiceInfo, getVoiceLanguage, type Voice } from "@/lib/voiceData"

interface VoiceSelectorProps {
    value: string
    onValueChange: (value: string) => void
}

// Grade color mapping
function getGradeColor(grade: string): string {
    if (grade.startsWith("A")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    if (grade.startsWith("B")) return "bg-sky-500/20 text-sky-400 border-sky-500/30"
    if (grade.startsWith("C")) return "bg-amber-500/20 text-amber-400 border-amber-500/30"
    if (grade.startsWith("D")) return "bg-orange-500/20 text-orange-400 border-orange-500/30"
    if (grade.startsWith("F")) return "bg-red-500/20 text-red-400 border-red-500/30"
    return "bg-muted text-muted-foreground border-border"
}

// Gender icon component
function GenderIcon({ gender }: { gender: "F" | "M" }) {
    return (
        <span
            className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                gender === "F"
                    ? "bg-pink-500/20 text-pink-400"
                    : "bg-blue-500/20 text-blue-400"
            )}
            aria-label={gender === "F" ? "Female" : "Male"}
        >
            {gender === "F" ? "♀" : "♂"}
        </span>
    )
}

// Voice row component
function VoiceRow({
    voice,
    isSelected,
    onSelect,
}: {
    voice: Voice
    isSelected: boolean
    onSelect: () => void
}) {
    return (
        <button
            onClick={onSelect}
            className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-150",
                "hover:bg-accent/50 focus:outline-none focus:bg-accent/50",
                isSelected && "bg-accent"
            )}
        >
            <GenderIcon gender={voice.gender} />
            <span className="flex-1 text-left text-sm font-medium truncate">
                {voice.name}
            </span>
            {voice.grade !== "?" && (
                <Badge
                    variant="outline"
                    className={cn(
                        "text-[10px] px-1.5 py-0 h-5 font-semibold shrink-0",
                        getGradeColor(voice.grade)
                    )}
                >
                    {voice.grade}
                </Badge>
            )}
            {isSelected && (
                <CheckIcon size={16} className="text-primary shrink-0" />
            )}
        </button>
    )
}

// Filter out Qwen3 voices - this selector is only for Kokoro
const KOKORO_VOICE_DATA = VOICE_DATA.filter((lang) => !lang.code.startsWith("qwen3"))

export function VoiceSelector({ value, onValueChange }: VoiceSelectorProps) {
    const [open, setOpen] = useState(false)

    // Determine the active tab based on current selection
    const selectedVoiceInfo = useMemo(() => {
        const lang = getVoiceLanguage(value)
        const voice = getVoiceInfo(value)
        return { lang, voice }
    }, [value])

    const defaultTab = selectedVoiceInfo.lang?.code ?? KOKORO_VOICE_DATA[0].code


    // Display text for trigger button
    const triggerText = useMemo(() => {
        if (selectedVoiceInfo.voice && selectedVoiceInfo.lang) {
            return `${selectedVoiceInfo.lang.flag} ${selectedVoiceInfo.voice.name}`
        }
        return value || "Select voice"
    }, [selectedVoiceInfo, value])

    const handleSelect = (voiceId: string) => {
        onValueChange(voiceId)
        setOpen(false)
    }

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal px-3"
                >
                    <span className="truncate">{triggerText}</span>
                    <CaretDownIcon size={16} className={cn(
                        "shrink-0 opacity-50 transition-transform duration-200",
                        open && "rotate-180"
                    )} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-[320px] p-0"
                align="start"
                sideOffset={4}
            >
                <Tabs defaultValue={defaultTab} className="w-full">
                    {/* Language tabs */}
                    <div className="border-b border-border px-1 pt-1">
                        <TabsList className="w-full h-auto flex-nowrap justify-between bg-transparent p-0">
                            {KOKORO_VOICE_DATA.map((lang) => (
                                <TabsTrigger
                                    key={lang.code}
                                    value={lang.code}
                                    className={cn(
                                        "flex-1 px-1.5 py-1.5 text-base data-[state=active]:bg-accent",
                                        "hover:bg-accent/50 transition-colors"
                                    )}
                                    title={lang.label}
                                >
                                    {lang.flag}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    {/* Voice lists per language */}
                    {KOKORO_VOICE_DATA.map((lang) => (
                        <TabsContent
                            key={lang.code}
                            value={lang.code}
                            className="mt-0 focus-visible:ring-0"
                        >
                            <ScrollArea className="h-[310px]">
                                <div className="p-1 space-y-0.5">
                                    {lang.voices.map((voice) => (
                                        <VoiceRow
                                            key={voice.id}
                                            voice={voice}
                                            isSelected={value === voice.id}
                                            onSelect={() => handleSelect(voice.id)}
                                        />
                                    ))}
                                </div>
                            </ScrollArea>
                        </TabsContent>
                    ))}
                </Tabs>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
