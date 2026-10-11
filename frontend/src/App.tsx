import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { connectLive } from './live'
import { useStore, type Page } from './store'
import Sidebar from './components/Sidebar'
import Overview from './components/Overview'
import AgentPage from './components/AgentPage'
import { Changes, Alerts, Feed } from './components/Lists'
import CodebaseMap from './components/CodebaseMap'
import AlertBanner from './components/AlertBanner'

const TITLES: Partial<Record<Page, string>> = { changes: 'Changes', alerts: 'Alerts', feed: 'Feed' }

// A failed human decision (Accept/Reject/Mark resolved could not reach the Python server).
// The list keeps its old state, so the person can simply try again.
function Notice() {
  const { notice, dismissNotice } = useStore()
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismissNotice, 6000)
    return () => clearTimeout(t)
  }, [notice, dismissNotice])
  if (!notice) return null
  return (
    <button onClick={dismissNotice} className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-line bg-canvas px-4 py-2 text-xs text-danger shadow-lg">
      {notice}
    </button>
  )
}

export default function App() {
  const { theme, page } = useStore()
  useEffect(connectLive, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <AlertBanner />
        <Notice />
        {page === 'map' ? (
          <ReactFlowProvider>
            <CodebaseMap />
          </ReactFlowProvider>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {page === 'overview' ? (
              <Overview />
            ) : page === 'agent' ? (
              <AgentPage />
            ) : (
              <div className="mx-auto max-w-3xl px-6 py-6">
                <h1 className="mb-4 text-lg font-semibold">{TITLES[page]}</h1>
                <div className="overflow-hidden rounded-xl border border-line">
                  {page === 'changes' && <Changes />}
                  {page === 'alerts' && <Alerts />}
                  {page === 'feed' && <Feed />}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
