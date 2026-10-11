import { useEffect, useState } from 'react'
import { useStore, agentColor, alertLabel, type Alert } from '../store'

// Flash over the map for ~5s when the coordinator raises an alert.
export default function AlertBanner() {
  const { lastAlert, agents, setPage } = useStore()
  const [shown, setShown] = useState<Alert | null>(null)

  useEffect(() => {
    if (!lastAlert) return
    setShown(lastAlert)
    const t = setTimeout(() => setShown(null), 5000)
    return () => clearTimeout(t)
  }, [lastAlert])

  if (!shown) return null
  return (
    <button
      onClick={() => setPage('alerts')}
      className="absolute top-4 left-1/2 z-10 w-[min(520px,90%)] -translate-x-1/2 rounded-2xl border border-line bg-canvas px-4 py-3 text-left shadow-lg"
    >
      <div className="text-xs font-semibold animate-flash">{alertLabel(shown.type)}</div>
      <div className="mt-1 text-sm">{shown.message}</div>
      <div className="mt-2 flex gap-3 text-xs text-muted">
        {shown.agents.map((id) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: agentColor(agents, id) }} />
            {agents[id]?.name ?? id}
          </span>
        ))}
      </div>
    </button>
  )
}
