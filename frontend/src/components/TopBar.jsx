import { useStore, openAlerts, pendingProposals } from '../store'

const CONN = {
  live: ['LIVE', 'bg-emerald-500'],
  mock: ['PLACEHOLDER DATA', 'bg-amber-400'],
  connecting: ['CONNECTING', 'bg-zinc-400 animate-pulse'],
  offline: ['OFFLINE', 'bg-red-500 animate-pulse'],
}

export default function TopBar() {
  const s = useStore()
  const [label, dot] = CONN[s.mock ? 'mock' : s.connection]
  const alerts = openAlerts(s).length
  const stats = [
    ['Agents', Object.values(s.agents).filter((a) => a.status !== 'idle').length + '/' + Object.keys(s.agents).length],
    ['Claims', s.claims.length],
    ['Pending', pendingProposals(s).length],
    ['Alerts', alerts, alerts > 0 && 'text-red-400'],
  ]
  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-zinc-800 bg-zinc-900 px-4">
      <div className="font-semibold tracking-wide">
        <span className="text-cyan-400">◉</span> Mission Control
      </div>
      <div className="flex items-center gap-2 rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
      </div>
      <div className="ml-auto flex gap-6 text-sm">
        {stats.map(([k, v, cls]) => (
          <div key={k} className="flex items-baseline gap-1.5">
            <span className="text-xs uppercase text-zinc-500">{k}</span>
            <span className={`font-mono font-semibold ${cls || ''}`}>{v}</span>
          </div>
        ))}
      </div>
    </header>
  )
}
