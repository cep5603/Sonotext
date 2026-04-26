import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextToSpeech } from './components/TextToSpeech'
import { LogPanel } from './components/LogPanel'
import { useStatusStream } from './hooks/useStatusStream'
import type { HistoryItem } from './types'

const queryClient = new QueryClient()

function InnerApp() {
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
  const [logoResetToken, setLogoResetToken] = useState(0)
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false)

  // Initialize global SSE connection for status updates
  useStatusStream()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('logs') === '1') {
      setIsLogPanelOpen(true)
      params.delete('logs')
      const search = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
    }

    const openLogs = () => setIsLogPanelOpen(true)
    window.addEventListener('sonotext-open-logs', openLogs)
    return () => window.removeEventListener('sonotext-open-logs', openLogs)
  }, [])

  const handleLogoClick = () => {
    setSelectedItem(null)
    setLogoResetToken((prev) => prev + 1)
  }

  return (
    <div className="h-screen bg-transparent text-foreground overflow-hidden">
      <TextToSpeech
        selectedItem={selectedItem}
        onSelectedItemChange={setSelectedItem}
        resetToGeneratorToken={logoResetToken}
        onLogoClick={handleLogoClick}
      />
      <LogPanel open={isLogPanelOpen} onOpenChange={setIsLogPanelOpen} />
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <InnerApp />
    </QueryClientProvider>
  )
}

export default App
