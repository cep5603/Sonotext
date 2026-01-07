import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextToSpeech } from './components/TextToSpeech'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
        <header className="text-center space-y-2 py-4 shrink-0">
          <h1 className="text-4xl font-light tracking-tight lg:text-5xl">
            Sonotext
          </h1>
        </header>
        <main className="flex-1 w-full min-h-0">
          <TextToSpeech />
        </main>
      </div>
    </QueryClientProvider>
  )
}

export default App
