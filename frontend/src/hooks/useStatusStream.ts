import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

export function useStatusStream() {
    const queryClient = useQueryClient()

    useEffect(() => {
        const eventSource = new EventSource("http://localhost:8000/api/status-stream")

        eventSource.addEventListener("status", (event) => {
            try {
                const data = JSON.parse(event.data)

                // Update qwen3 info directly
                queryClient.setQueryData(["qwen3-info"], data.qwen3_info)

                // Update LLM status query
                queryClient.setQueryData(["llm-model-status"], {
                    model: data.current_llm,
                    status: data.llm_status
                })

                // Update LLM general availability
                queryClient.setQueryData(["llm-status"], {
                    available: data.llm_available,
                    currentModel: data.current_llm
                })

                // Update LLM active models if provided
                if (data.llm_available) {
                    queryClient.setQueryData(["llm-models"], {
                        models: data.llm_models,
                        currentModel: data.current_llm
                    })
                }

            } catch (err) {
                console.error("Failed to parse status stream event", err)
            }
        })

        eventSource.onerror = (error) => {
            console.error("SSE error in status-stream:", error)
            // EventSource will automatically try to reconnect
        }

        return () => {
            eventSource.close()
        }
    }, [queryClient])
}
