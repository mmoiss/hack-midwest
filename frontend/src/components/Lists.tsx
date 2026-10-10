import { diffLines } from 'diff'
import { useStore, agentColor, type Agent, type FeedEvent } from '../store'

// The three list pages. Each takes `limit` so the overview can show a slice of the same rows.

const STATUS_PILL: Record<string, string> = {
  pending: 'bg-surface text-muted',
  accepted: 'bg-ok-soft text-ok',
  rejected: 'bg-surface text-faint line-through',
}

type Filter = { limit?: number; agentId?: string }

export function Changes({ limit, agentId, pendingOnly = false }: Filter & { pendingOnly?: boolean }) {
  const { proposals, agents, selectedProposal, selectProposal, decideProposal } = useStore()
  const list = proposals
    .filter((p) => (!pendingOnly || p.status === 'pending') && (!agentId || p.agentId === agentId))
    .slice(0, limit)
  if (!list.length) return <Empty>{pendingOnly ? 'Nothing waiting on you' : 'No changes yet'}</Empty>
  return (
    <ul className="divide-y divide-line">
      {list.map((p) => {
        const a = agents[p.agentId]
        const open = selectedProposal === p.id
        return (
          <li key={p.id}>
            <button onClick={() => selectProposal(p.id)} className="w-full px-4 py-3 text-left transition-colors hover:bg-surface">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: agentColor(agents, p.agentId) }} />
                <span className="text-xs text-muted">{a?.name}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[p.status]}`}>{p.status}</span>
              </div>
              <div className="mt-1.5 text-sm font-medium">{p.title}</div>
              <div className="mt-0.5 font-mono text-[11px] text-faint">{p.target}</div>
            </button>
            {open && (
              <div className="px-4 pb-4">
                {p.rationale && <p className="mb-2 text-xs text-muted">{p.rationale}</p>}
                {p.affects?.length > 0 && (
                  <p className="mb-2 text-xs text-muted">
                    Affects {p.affects.map((id) => agents[id]?.name ?? id).join(', ')}
                  </p>
                )}
                <Diff before={p.before} after={p.after} />
                {p.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => decideProposal(p.id, 'accepted')} className="flex-1 rounded-lg bg-ink py-1.5 text-sm font-medium text-ink-fg transition-opacity hover:opacity-80">Accept</button>
                    <button onClick={() => decideProposal(p.id, 'rejected')} className="flex-1 rounded-lg bg-surface py-1.5 text-sm font-medium transition-opacity hover:opacity-80">Reject</button>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Diff({ before = '', after = '' }) {
  const parts = diffLines(before, after)
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface py-2 font-mono text-[11px] leading-5">
      {parts.flatMap((part, i) =>
        part.value.replace(/\n$/, '').split('\n').map((line, j) => (
          <div
            key={`${i}-${j}`}
            className={`px-2 ${part.added ? 'bg-ok-soft text-ok' : part.removed ? 'bg-danger-soft text-danger' : 'text-muted'}`}
          >
            {part.added ? '+ ' : part.removed ? '- ' : '  '}
            {line}
          </div>
        )),
      )}
    </pre>
  )
}

export function Alerts({ limit, agentId, openOnly = false }: Filter & { openOnly?: boolean }) {
  const { alerts, agents, resolveAlert, selectFile, setPage, focusAlert } = useStore()
  const list = [...alerts]
    .sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1))
    .filter((a) => (!openOnly || a.status === 'open') && (!agentId || a.agents.includes(agentId)))
    .slice(0, limit)
  if (!list.length) return <Empty>{openOnly ? 'All clear' : 'No alerts'}</Empty>
  return (
    <ul className="divide-y divide-line">
      {list.map((al) => {
        const done = al.status === 'resolved'
        return (
          <li key={al.id} className={`px-4 py-3 ${done ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold">{al.type === 'decision' ? 'Human decision' : al.type === 'collision' ? 'Collision' : 'Contract drift'}</span>
              {al.severity && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">{al.severity}</span>}
              <span className="ml-auto text-faint">{new Date(al.ts).toLocaleTimeString()}</span>
            </div>
            <p className="mt-1.5 text-sm">{al.message}</p>
            {al.contract && <p className="mt-1 font-mono text-xs text-muted">{al.contract}</p>}
            {al.suggestion && <p className="mt-1 text-xs text-muted">{al.suggestion}</p>}
            <div className="mt-2 flex flex-wrap gap-1">
              {al.agents.map((id) => (
                <span key={id} className="flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: agentColor(agents, id) }} />
                  {agents[id]?.name ?? id}
                </span>
              ))}
              {al.files.map((f) => (
                <button
                  key={f}
                  onClick={() => { selectFile(f); setPage('map') }}
                  className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-muted hover:text-fg"
                >
                  {f.split('/').pop()}
                </button>
              ))}
            </div>
            <button onClick={() => focusAlert(al.id)} className="mt-2 mr-4 text-xs font-medium hover:underline">Show on map</button>
            {!done && (
              <button onClick={() => resolveAlert(al.id)} className="mt-2 text-xs text-muted hover:text-fg">
                Mark resolved
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function describe(e: FeedEvent, agents: Record<string, Agent>): [string | null, string] {
  const name = (id: string) => agents[id]?.name ?? id
  const d = e.data
  switch (e.type) {
    case 'agent.upsert': return [d.id, `${name(d.id)} ${d.status ?? 'updated'}`]
    case 'file.touch': return [d.agentId, `${name(d.agentId)} editing ${d.path}`]
    case 'claim.add': return [d.agentId, `${name(d.agentId)} claimed ${d.path}`]
    case 'claim.release': return [d.agentId, `${name(d.agentId)} released ${d.path}`]
    case 'proposal.add': return [d.agentId, `${name(d.agentId)} proposed ${d.title}`]
    case 'proposal.update': return [null, `Proposal ${d.id} ${d.status}`]
    case 'alert.add': return [null, `${d.type}: ${d.message}`]
    case 'alert.resolve': return [null, `Alert ${d.id} resolved`]
    case 'file.add': return [null, `New file ${d.path}`]
    default: return [d.agentId, `${name(d.agentId)} ${e.type}`]
  }
}

export function Feed({ limit, agentId }: Filter) {
  const { events, agents } = useStore()
  const list = events
    .map((e) => [e, ...describe(e, agents)] as const)
    .filter(([e, who]) => !agentId || who === agentId || e.data?.agents?.includes?.(agentId))
    .slice(0, limit)
  if (!list.length) return <Empty>No events yet</Empty>
  return (
    <ul className="space-y-1.5 px-4 py-3 text-xs">
      {list.map(([e, who, text]) => (
          <li key={e.id} className="flex gap-2">
            <span className="shrink-0 tabular-nums text-faint">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: who ? agentColor(agents, who) : 'var(--line)' }} />
            <span>{text}</span>
          </li>
      ))}
    </ul>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-faint">{children}</div>
}
