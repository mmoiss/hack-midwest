import { useStore, agentColor } from '../store'
import { Changes, Alerts, Feed, Empty } from './Lists'
import { Section } from './Overview'
import Ship from './Ship'

const STATUS: Record<string, string> = {
  editing: 'bg-ok-soft text-ok',
  blocked: 'bg-danger-soft text-danger',
}

// Everything one agent is doing: task, claims, proposals, alerts and activity.
export default function AgentPage() {
  const { agents, claims, selectedAgent, selectFile, setPage } = useStore()
  const a = selectedAgent ? agents[selectedAgent] : null
  if (!a) return <Empty>Pick an agent from the sidebar</Empty>
  const mine = claims.filter((c) => c.agentId === a.id)

  return (
    <div className="flex min-h-full flex-col">
      <Ship focus={a.id} />
      <div className="flex-1 bg-[var(--water-deep)]">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full" style={{ background: agentColor(agents, a.id) }} />
            <h1 className="text-lg font-semibold">{a.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[a.status ?? ''] ?? 'bg-surface text-muted'}`}>{a.status}</span>
          </div>
          {a.task && <p className="mt-2 text-sm text-muted">{a.task}</p>}
          {a.currentFile && (
            <p className="mt-1 text-xs text-muted">
              Editing <button onClick={() => { selectFile(a.currentFile!); setPage('map') }} className="font-mono hover:text-fg">{a.currentFile}</button>
            </p>
          )}

          <div className="mt-6 space-y-6">
            <Section title="Claims">
              {mine.length ? (
                <ul className="divide-y divide-line">
                  {mine.map((c) => (
                    <li key={c.path} className="px-4 py-2.5 text-xs">
                      <button onClick={() => { selectFile(c.path); setPage('map') }} className="font-mono hover:underline">{c.path}</button>
                      <span className="text-muted">: {c.intent}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No claims</Empty>
              )}
            </Section>
            <Section title="Changes"><Changes agentId={a.id} /></Section>
            <Section title="Alerts"><Alerts agentId={a.id} /></Section>
            <Section title="Activity"><Feed agentId={a.id} limit={50} /></Section>
          </div>
        </div>
      </div>
    </div>
  )
}
