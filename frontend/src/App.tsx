import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextToSpeech } from './components/TextToSpeech'
import { useStatusStream } from './hooks/useStatusStream'
import type { HistoryItem } from './types'

const queryClient = new QueryClient()

function InnerApp() {
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
  const [logoResetToken, setLogoResetToken] = useState(0)

  // Initialize global SSE connection for status updates
  useStatusStream()

  const handleLogoClick = () => {
    setSelectedItem(null)
    setLogoResetToken((prev) => prev + 1)
  }

  return (
    <div className="h-screen bg-background text-foreground overflow-hidden">
      <TextToSpeech
        selectedItem={selectedItem}
        onSelectedItemChange={setSelectedItem}
        resetToGeneratorToken={logoResetToken}
        onLogoClick={handleLogoClick}
      />
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
