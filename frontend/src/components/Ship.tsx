import { useState } from 'react'
import { useStore, agentColor, openAlerts, pendingProposals, alertTargets } from '../store'
import { BRAND, HULL, SKEG } from './Logo'

const COORDINATOR = 'coordinator'

const BOAT = 2.2
const DECK_Y = 122
const BOAT_X = 505 - (102 * BOAT)
const BOAT_Y = DECK_Y - 100 * BOAT
const DECK_W = 156 * BOAT
const H = 300

type CrewState = 'blocked' | 'changing a contract' | 'editing' | 'idle'
const STATES: CrewState[] = ['blocked', 'changing a contract', 'editing', 'idle']

function wave(y: number, amp: number, period: number) {
  let d = `M0 ${y}`
  for (let x = 0; x < 2000; x += period) d += ` q${period / 4} ${-amp} ${period / 2} 0 t${period / 2} 0`
  return `${d} V${H} H0 Z`
}
const WAVE_BACK = wave(160, 5, 100)
const WAVE_FRONT = wave(172, 7, 125)

export default function Ship({ focus }: { focus?: string }) {
  const s = useStore()
  const [shown, setShown] = useState(focus)
  const [leaving, setLeaving] = useState<string>()
  if (focus !== shown) {
    setLeaving(shown)
    setShown(focus)
  }
  const open = openAlerts(s)
  const pending = pendingProposals(s)
  const blocked = new Set(open.flatMap((a) => alertTargets(s, a).agents))
  const changing = new Set(pending.map((p) => p.agentId))

  const crew = Object.values(s.agents)
    .filter((a) => a.id !== COORDINATOR)
    .map((a) => {
      const state: CrewState = blocked.has(a.id) ? 'blocked' : changing.has(a.id) ? 'changing a contract' : a.currentFile ? 'editing' : 'idle'
      return { ...a, state, color: agentColor(s.agents, a.id) }
    })

  const counts = STATES
    .map((st) => [st, crew.filter((c) => c.state === st).length] as const)
    .filter(([, n]) => n)
    .map(([st, n]) => `${n} ${st}`)

  const gap = Math.min(64, (DECK_W - 40) / Math.max(crew.length, 1))
  const scale = Math.min(1, gap / 56)

  return (
    <section>
      {!focus && (
        <div className="px-6 pt-5">
          <h1 className="text-lg font-semibold">On deck</h1>
          <p className="text-sm text-muted">{crew.length ? counts.join(', ') : 'No crew on deck yet'}</p>
        </div>
      )}
      <svg viewBox={`0 0 1000 ${H}`} className="block h-auto w-full" role="group" aria-label={`${crew.length} agents on deck${open.length ? `, ${open.length} open alert` : ''}`}>
        <g className="skeg-wave-back"><path d={WAVE_BACK} fill="var(--water-back)" /></g>

        <g className="skeg-members">
          {crew.map((c, i) => {
            const pose = !focus ? undefined : c.id === focus ? 'skeg-stand-up' : c.id === leaving ? 'skeg-sit-down' : 'skeg-seated'
            return (
              <a
                key={c.id}
                href="#"
                aria-label={`Open ${c.name}`}
                aria-current={c.id === focus ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); s.openAgent(c.id) }}
                className="cursor-pointer"
              >
                <g transform={`translate(${505 + (i - (crew.length - 1) / 2) * gap} ${DECK_Y}) scale(${scale})`}>
                  <title>{`${c.name} - ${c.state}${c.currentFile ? ` - ${c.currentFile}` : ''}`}</title>
                  <g className={pose}>
                    <text y="-72" textAnchor="middle" fill="var(--fg)" fontSize="12" fontWeight="500">{c.name}</text>
                    <circle cy="-48" r="11" fill={c.color} />
                    <path d="M-12 -2 V-20 a12 12 0 0 1 24 0 V-2 Z" fill={c.color} />
                  </g>
                </g>
              </a>
            )
          })}
          <g transform={`translate(${BOAT_X} ${BOAT_Y}) scale(${BOAT})`}>
            <path d={HULL} fill="var(--ink)" />
            <path d={SKEG} fill={BRAND} />
          </g>
        </g>

        <g className="skeg-wave-front"><path d={WAVE_FRONT} fill="var(--water-front)" fillOpacity="0.8" /></g>
      </svg>
    </section>
  )
}
