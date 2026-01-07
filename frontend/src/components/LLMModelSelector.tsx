import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"

interface LLMModel {
    id: string
    publisher: string
    quantization: string
    state: string
    max_context_length: number
    size_bytes: number
}

interface LLMModelsResponse {
    models: LLMModel[]
    currentModel: string
}



export function LLMModelSelector() {
    const queryClient = useQueryClient()

    const { data, isLoading } = useQuery({
        queryKey: ["llm-models"],
        queryFn: async () => {
            const res = await axios.get("http://localhost:8000/api/llm-models")
            return res.data as LLMModelsResponse
        },
        refetchInterval: 30000,
    })

    const setModelMutation = useMutation({
        mutationFn: async (model: string) => {
            await axios.post("http://localhost:8000/api/llm-model", { model })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["llm-models"] })
        },
    })

    if (isLoading || !data) {
        return (
            <Select disabled>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Loading models..." />
                </SelectTrigger>
            </Select>
        )
    }

    if (data.models.length === 0) {
        return (
            <Select disabled>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="No LLM models available" />
                </SelectTrigger>
            </Select>
        )
    }

    return (
        <Select
            value={data.currentModel}
            onValueChange={(value) => setModelMutation.mutate(value)}
        >
            <SelectTrigger className="w-full">
                <SelectValue placeholder="Select LLM model" />
            </SelectTrigger>
            <SelectContent>
                {data.models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                            <span className="truncate">{model.id}</span>
                            {model.quantization && (
                                <Badge
                                    variant={model.state === "loaded" ? "default" : "secondary"}
                                    className="text-[10px] px-1 py-0"
                                >
                                    {model.quantization}
                                </Badge>
                            )}
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
