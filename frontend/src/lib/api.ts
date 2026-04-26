export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (
    window.location.port === "5173" ? "http://localhost:8000" : window.location.origin
)

export function apiUrl(path: string) {
    if (/^https?:\/\//i.test(path)) {
        return path
    }

    return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}
