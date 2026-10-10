import { useEffect, useState } from 'react'
import { useStore } from '../store'

// Full-width flash over the map for ~5s when the coordinator raises an alert.
export default function AlertBanner() {
  const { lastAlert, agents, setTab } = useStore()
  const [shown, setShown] = useState(null)

  useEffect(() => {
    if (!lastAlert) return
    setShown(lastAlert)
    const t = setTimeout(() => setShown(null), 5000)
    return () => clearTimeout(t)
  }, [lastAlert])

  if (!shown) return null
  const red = shown.type === 'collision'
  return (
    <button
      onClick={() => setTab('alerts')}
      className={`absolute top-4 left-1/2 z-10 w-[min(560px,90%)] -translate-x-1/2 rounded-lg border px-4 py-3 text-left shadow-2xl ${
        red ? 'border-red-500 bg-red-950/90' : 'border-amber-400 bg-amber-950/90'
      }`}
    >
      <div className={`text-xs font-bold uppercase ${red ? 'text-red-400' : 'text-amber-400'} animate-flash`}>
        ⚠ {red ? 'Collision detected' : 'Context drift detected'}
      </div>
      <div className="mt-1 text-sm">{shown.message}</div>
      <div className="mt-1 flex gap-2 text-xs">
        {shown.agents.map((id) => (
          <span key={id} style={{ color: agents[id]?.color }}>● {agents[id]?.name ?? id}</span>
        ))}
      </div>
    </button>
  )
}
