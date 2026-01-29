import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2, Mic, Palette, Upload, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { VoiceManagerDialog } from "@/components/VoiceManagerDialog"
import type { VoiceProfile } from "@/types"

interface CustomVoicesSectionProps {
    selectedProfileId: string | null
    onProfileSelect: (profileId: string | null) => void
}

export function CustomVoicesSection({
    selectedProfileId,
    onProfileSelect
}: CustomVoicesSectionProps) {
    const [managerOpen, setManagerOpen] = useState(false)
    const [createDialogOpen, setCreateDialogOpen] = useState(false)

    const { data: profiles, isLoading } = useQuery({
        queryKey: ["voice-profiles"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/voice-profiles")
            return res.data.profiles as VoiceProfile[]
        },
    })

    // Find selected profile
    const selectedProfile = profiles?.find((p) => p.id === selectedProfileId)

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-sm">Custom Voice</Label>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setManagerOpen(true)}
                >
                    Manage...
                </Button>
            </div>

            {/* Quick selection */}
            <div className="space-y-1">
                {/* None option */}
                <button
                    onClick={() => onProfileSelect(null)}
                    className={cn(
                        "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                        selectedProfileId === null
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted text-muted-foreground"
                    )}
                >
                    None (use speaker)
                </button>

                {/* Selected profile (if any) */}
                {selectedProfile && (
                    <div
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                            "bg-primary text-primary-foreground"
                        )}
                    >
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                {selectedProfile.source === "designed" ? (
                                    <Palette className="h-3 w-3 shrink-0 opacity-70" />
                                ) : (
                                    <Mic className="h-3 w-3 shrink-0 opacity-70" />
                                )}
                                <span className="truncate font-medium">{selectedProfile.name}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Show count if there are more profiles */}
                {profiles && profiles.length > 0 && !selectedProfile && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                        {profiles.length} voice{profiles.length !== 1 ? "s" : ""} available
                    </p>
                )}
            </div>

            {/* Voice Manager Dialog */}
            <VoiceManagerDialog
                open={managerOpen}
                onOpenChange={setManagerOpen}
                selectedProfileId={selectedProfileId}
                onProfileSelect={onProfileSelect}
                onCreateVoice={() => setCreateDialogOpen(true)}
            />

            {/* Create Voice Dialog */}
            <CreateVoiceDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
            />
        </div>
    )
}

interface CreateVoiceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

function CreateVoiceDialog({ open, onOpenChange }: CreateVoiceDialogProps) {
    const queryClient = useQueryClient()
    const [tab, setTab] = useState<"design" | "upload">("design")

    // Design form state
    const [designName, setDesignName] = useState("")
    const [designDescription, setDesignDescription] = useState("")
    const [designLanguage, setDesignLanguage] = useState("Auto")

    // Upload form state
    const [uploadName, setUploadName] = useState("")
    const [uploadTranscript, setUploadTranscript] = useState("")
    const [uploadLanguage, setUploadLanguage] = useState("Auto")
    const [uploadFile, setUploadFile] = useState<File | null>(null)

    const designMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post("http://localhost:8000/api/voice-profiles/design", {
                name: designName,
                description: designDescription,
                language: designLanguage,
            })
            return res.data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["voice-profiles"] })
            onOpenChange(false)
            resetForm()
        },
    })

    const uploadMutation = useMutation({
        mutationFn: async () => {
            if (!uploadFile) throw new Error("No file selected")

            const formData = new FormData()
            formData.append("audio", uploadFile)
            formData.append("name", uploadName)
            formData.append("transcript", uploadTranscript)
            formData.append("language", uploadLanguage)

            const res = await axios.post(
                "http://localhost:8000/api/voice-profiles/upload",
                formData,
                { headers: { "Content-Type": "multipart/form-data" } }
            )
            return res.data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["voice-profiles"] })
            onOpenChange(false)
            resetForm()
        },
    })

    const transcribeMutation = useMutation({
        mutationFn: async () => {
            if (!uploadFile) throw new Error("No file selected")

            const formData = new FormData()
            formData.append("audio", uploadFile)

            // Map language to ISO code for transcription
            const langMap: Record<string, string> = {
                "Auto": "eng",
                "English": "eng",
                "Chinese": "cmn",
                "Japanese": "jpn",
                "Korean": "kor",
            }
            formData.append("language", langMap[uploadLanguage] || "eng")

            const res = await axios.post(
                "http://localhost:8000/api/transcribe",
                formData,
                { headers: { "Content-Type": "multipart/form-data" } }
            )
            return res.data.transcript as string
        },
        onSuccess: (transcript) => {
            setUploadTranscript(transcript)
        },
    })

    const resetForm = () => {
        setDesignName("")
        setDesignDescription("")
        setDesignLanguage("Auto")
        setUploadName("")
        setUploadTranscript("")
        setUploadLanguage("Auto")
        setUploadFile(null)
    }

    const isPending = designMutation.isPending || uploadMutation.isPending || transcribeMutation.isPending

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="mb-4">
                    <DialogTitle>Create Custom Voice</DialogTitle>
                </DialogHeader>

                <Tabs value={tab} onValueChange={(v) => setTab(v as "design" | "upload")}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="design" className="gap-1.5">
                            <Palette className="h-3.5 w-3.5" />
                            Design Voice
                        </TabsTrigger>
                        <TabsTrigger value="upload" className="gap-1.5">
                            <Upload className="h-3.5 w-3.5" />
                            Clone Voice
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="design" className="space-y-4 mt-4">
                        <div className="space-y-2">
                            <Label>Voice Name</Label>
                            <Input
                                placeholder="e.g., Friendly Host"
                                value={designName}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDesignName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Voice Description</Label>
                            <Textarea
                                placeholder="e.g., Male, 35 years old, baritone, warm and professional with a hint of enthusiasm"
                                value={designDescription}
                                onChange={(e) => setDesignDescription(e.target.value)}
                                className="h-24"
                            />
                            <p className="text-xs text-muted-foreground">
                                Describe the voice you want: age, gender, pitch, tone, personality, etc.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Language</Label>
                            <Select value={designLanguage} onValueChange={setDesignLanguage}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Auto">Auto Detect</SelectItem>
                                    <SelectItem value="English">English</SelectItem>
                                    <SelectItem value="Chinese">Chinese</SelectItem>
                                    <SelectItem value="Japanese">Japanese</SelectItem>
                                    <SelectItem value="Korean">Korean</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            className="w-full"
                            onClick={() => designMutation.mutate()}
                            disabled={!designName || !designDescription || isPending}
                        >
                            {designMutation.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Creating Voice...
                                </>
                            ) : (
                                <>
                                    <Palette className="h-4 w-4 mr-2" />
                                    Create Voice
                                </>
                            )}
                        </Button>
                        {designMutation.isError && (
                            <p className="text-sm text-destructive">
                                {(designMutation.error as Error).message || "Failed to create voice"}
                            </p>
                        )}
                    </TabsContent>

                    <TabsContent value="upload" className="space-y-4 mt-4">
                        <div className="space-y-2">
                            <Label>Voice Name</Label>
                            <Input
                                placeholder="e.g., My Voice"
                                value={uploadName}
                                onChange={(e) => setUploadName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Audio File</Label>
                            <Input
                                type="file"
                                accept="audio/*"
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUploadFile(e.target.files?.[0] || null)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Upload a short (~10 second) audio sample of the voice to clone.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Transcript</Label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => transcribeMutation.mutate()}
                                    disabled={!uploadFile || isPending}
                                >
                                    {transcribeMutation.isPending ? (
                                        <>
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                            Transcribing...
                                        </>
                                    ) : (
                                        <>
                                            <Wand2 className="h-3 w-3 mr-1" />
                                            Auto-transcribe
                                        </>
                                    )}
                                </Button>
                            </div>
                            <Textarea
                                placeholder="Enter the exact words spoken in the audio file"
                                value={uploadTranscript}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setUploadTranscript(e.target.value)}
                                className="h-20"
                            />
                            {transcribeMutation.isError && (
                                <p className="text-xs text-destructive">
                                    Transcription failed. Please enter manually.
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Language</Label>
                            <Select value={uploadLanguage} onValueChange={setUploadLanguage}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Auto">Auto Detect</SelectItem>
                                    <SelectItem value="English">English</SelectItem>
                                    <SelectItem value="Chinese">Chinese</SelectItem>
                                    <SelectItem value="Japanese">Japanese</SelectItem>
                                    <SelectItem value="Korean">Korean</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            className="w-full"
                            onClick={() => uploadMutation.mutate()}
                            disabled={!uploadName || !uploadFile || !uploadTranscript || isPending}
                        >
                            {uploadMutation.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Mic className="h-4 w-4 mr-2" />
                                    Clone Voice
                                </>
                            )}
                        </Button>
                        {uploadMutation.isError && (
                            <p className="text-sm text-destructive">
                                {(uploadMutation.error as Error).message || "Failed to upload voice"}
                            </p>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
