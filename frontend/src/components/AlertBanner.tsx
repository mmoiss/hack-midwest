import { useEffect, useState } from 'react'
import { useStore, agentColor, alertLabel, type Alert, type Proposal } from '../store'

type Shown = { kind: 'alert'; alert: Alert } | { kind: 'proposal'; proposal: Proposal }

const CARD = 'absolute top-4 left-1/2 z-10 w-[min(520px,90%)] -translate-x-1/2 rounded-2xl border border-line bg-canvas px-4 py-3 text-left shadow-lg'

// Flash over the page for ~5s when something needs attention: an alert from the
// coordinator, or a proposal waiting on a human decision. Only live arrivals flash;
// a reconnect's snapshot does not replay them.
export default function AlertBanner() {
  const { lastAlert, lastProposal, agents, setPage, openProposal } = useStore()
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    if (!lastAlert) return
    setShown({ kind: 'alert', alert: lastAlert })
    const t = setTimeout(() => setShown(null), 5000)
    return () => clearTimeout(t)
  }, [lastAlert])
  useEffect(() => {
    if (!lastProposal) return
    setShown({ kind: 'proposal', proposal: lastProposal })
    const t = setTimeout(() => setShown(null), 5000)
    return () => clearTimeout(t)
  }, [lastProposal])

  if (!shown) return null
  if (shown.kind === 'proposal') {
    const p = shown.proposal
    return (
      <button onClick={() => openProposal(p.id)} className={CARD}>
        <div className="text-xs font-semibold animate-flash">Needs your decision</div>
        <div className="mt-1 text-sm">
          <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: agentColor(agents, p.agentId) }} />{' '}
          {agents[p.agentId]?.name ?? p.agentId} proposed a change to {p.title}
        </div>
        {p.rationale && <div className="mt-1 text-xs text-muted">{p.rationale}</div>}
      </button>
    )
  }
  const a = shown.alert
  return (
    <button onClick={() => setPage('alerts')} className={CARD}>
      <div className="text-xs font-semibold animate-flash">{alertLabel(a.type)}</div>
      <div className="mt-1 text-sm">{a.message}</div>
      <div className="mt-2 flex gap-3 text-xs text-muted">
        {a.agents.map((id) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: agentColor(agents, id) }} />
            {agents[id]?.name ?? id}
          </span>
        ))}
      </div>
    </button>
  )
}
