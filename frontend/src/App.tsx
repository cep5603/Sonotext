import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextToSpeech } from './components/TextToSpeech'
import { AnimatedLogo } from './components/AnimatedLogo'
import type { HistoryItem } from './types'

const queryClient = new QueryClient()

function App() {
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)

  const handleLogoClick = () => {
    setSelectedItem(null)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
        <header className="text-center py-4 shrink-0 border-b border-border">
          <AnimatedLogo onClick={handleLogoClick} />
        </header>
        <main className="flex-1 w-full min-h-0">
          <TextToSpeech
            selectedItem={selectedItem}
            onSelectedItemChange={setSelectedItem}
          />
        </main>
      </div>
    </QueryClientProvider>
  )
}

export default App
