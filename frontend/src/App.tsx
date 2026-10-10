import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { connectLive } from './live'
import { useStore } from './store'
import TopBar from './components/TopBar'
import AgentPanel from './components/AgentPanel'
import CodebaseMap from './components/CodebaseMap'
import RightPanel from './components/RightPanel'
import AlertBanner from './components/AlertBanner'

export default function App() {
  const theme = useStore((s) => s.theme)
  useEffect(connectLive, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 divide-x divide-line">
        <AgentPanel />
        <main className="relative min-w-0 flex-1 overflow-hidden">
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
