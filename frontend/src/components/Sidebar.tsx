import { useState } from 'react'
import { useStore, openAlerts, pendingProposals, agentColor, type Page } from '../store'
import Logo from './Logo'
import Icon, { type IconName } from './Icon'

const STATUS_DOT: Record<string, string> = {
  editing: 'bg-ok',
  blocked: 'bg-danger',
}

const item = (active: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${active ? 'bg-surface' : 'text-muted hover:bg-surface hover:text-fg'}`

export default function Sidebar() {
  const s = useStore()
  const [crewOpen, setCrewOpen] = useState(true)
  const [accountOpen, setAccountOpen] = useState(false)
  const agents = Object.values(s.agents)
  const nav: [Page, IconName, string, number?][] = [
    ['changes', 'changes', 'Changes', pendingProposals(s).length],
    ['alerts', 'alerts', 'Alerts', openAlerts(s).length],
    ['feed', 'feed', 'Feed'],
    ['map', 'map', 'Map'],
  ]
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line">
      <button onClick={() => s.setPage('overview')} className="flex h-16 items-center gap-3 px-5 text-left">
        <Logo size={50} />
        <span className="text-4xl font-semibold tracking-tight text-[#7a9a6e]">skeg</span>
      </button>

      {/* Project picker: owner/repo, like GitHub. */}
      <div className="relative px-3 pb-2">
        <select
          value={s.project}
          onChange={(e) => s.setProject(e.target.value)}
          className="w-full cursor-pointer appearance-none truncate rounded-lg border border-line bg-transparent py-1.5 pr-8 pl-3 text-sm font-medium transition-colors hover:bg-surface focus:bg-surface focus:outline-none"
        >
          {s.projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Icon name="chevron" size={14} className="pointer-events-none absolute top-1/2 right-6 -translate-y-1/2 text-muted" />
      </div>

      <nav className="flex flex-col gap-0.5 overflow-y-auto px-3 pt-1">
        <button onClick={() => s.setPage('overview')} className={item(s.page === 'overview')}>
          <Icon name="overview" />
          Overview
        </button>

        <button onClick={() => setCrewOpen(!crewOpen)} className={item(false)}>
          <Icon name="crew" />
          Crew
          <Icon name="chevron" size={12} className={`ml-auto transition-transform ${crewOpen ? '' : '-rotate-90'}`} />
        </button>
        {crewOpen && (
          <ul className="mb-1 ml-5 flex flex-col gap-0.5 border-l border-line pl-2">
            {agents.length === 0 && <li className="px-3 py-1.5 text-xs text-faint">No agents yet</li>}
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => s.openAgent(a.id)}
                  onMouseEnter={() => s.hoverAgent(a.id)}
                  onMouseLeave={() => s.hoverAgent(null)}
                  className={`${item(s.page === 'agent' && s.selectedAgent === a.id)} gap-2 py-1.5`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(s.agents, a.id) }} />
                  <span className="truncate">{a.name}</span>
                  <span title={a.status} className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[a.status ?? ''] ?? 'bg-faint'}`} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {nav.map(([id, icon, label, n]) => (
          <button key={id} onClick={() => s.setPage(id)} className={item(s.page === id)}>
            <Icon name={icon} />
            {label}
            {n ? (
              <span className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${id === 'alerts' ? 'bg-danger text-white' : 'bg-ink text-ink-fg'}`}>{n}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {/* Account: a stub that holds the theme toggle until there's a real login. */}
      <div className="relative mt-auto border-t border-line p-3">
        {accountOpen && (
          <div className="absolute bottom-full left-3 mb-1 w-[calc(100%-1.5rem)] rounded-xl border border-line bg-canvas p-1 shadow-lg">
            <button onClick={s.toggleTheme} className={item(false)}>
              <Icon name={s.theme === 'dark' ? 'sun' : 'moon'} />
              {s.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        )}
        <button onClick={() => setAccountOpen(!accountOpen)} className={item(accountOpen)}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-muted">
            <Icon name="user" size={14} />
          </span>
          Account
          <Icon name="chevron" size={12} className={`ml-auto transition-transform ${accountOpen ? '' : 'rotate-180'}`} />
        </button>
      </div>
    </aside>
  )
}
