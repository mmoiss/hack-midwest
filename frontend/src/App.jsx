import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { connectLive } from './ws'
import { startMock } from './mock'
import TopBar from './components/TopBar'
import AgentPanel from './components/AgentPanel'
import CodebaseMap from './components/CodebaseMap'
import RightPanel from './components/RightPanel'
import AlertBanner from './components/AlertBanner'

export default function App() {
  // Placeholder data plays until the backend connects, then it is cleared.
  useEffect(() => {
    const stopMock = startMock()
    const stopLive = connectLive(undefined, stopMock)
    return () => {
      stopMock()
      stopLive()
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <AgentPanel />
        <main className="relative min-w-0 flex-1">
          <ReactFlowProvider>
            <CodebaseMap />
          </ReactFlowProvider>
          <AlertBanner />
        </main>
        <RightPanel />
      </div>
    </div>
  )
}
