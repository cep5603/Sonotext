import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextToSpeech } from './components/TextToSpeech'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground flex flex-col p-4">
        <header className="text-center space-y-2 mb-6">
          <h1 className="text-4xl font-light tracking-tight lg:text-5xl">
            Sonotext
          </h1>
          <p className="text-muted-foreground text-lg">
            Local. Fast. Private.
          </p>
        </header>
        <main className="flex-1 max-w-7xl mx-auto w-full">
          <TextToSpeech />
        </main>
      </div>
    </QueryClientProvider>
  )
}

export default App
