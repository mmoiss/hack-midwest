import { useStore } from './store'

// Placeholder data: a scripted replay of the demo story (contract drift + a
// file collision, caught and resolved). Runs only until the real backend
// connects, then clears itself. Loops so the dashboard is never empty.

const AGENTS = [
  { id: 'alice', name: 'Alice', owner: 'Alice', tool: 'Claude Code', color: '#22d3ee', status: 'idle', task: 'Split user name into first/last' },
  { id: 'bob', name: 'Bob', owner: 'Bob', tool: 'Cursor', color: '#a78bfa', status: 'idle', task: 'Build profile card UI' },
  { id: 'carol', name: 'Carol', owner: 'Carol', tool: 'Codex', color: '#f472b6', status: 'idle', task: 'Add order history model' },
]

const FILES = [
  { path: 'spec/contracts.yaml' },
  { path: 'backend/api/users.py', deps: ['spec/contracts.yaml', 'backend/models.py'] },
  { path: 'backend/api/orders.py', deps: ['spec/contracts.yaml', 'backend/models.py'] },
  { path: 'backend/models.py' },
  { path: 'backend/schemas.py', deps: ['backend/models.py'] },
  { path: 'frontend/src/api/client.ts', deps: ['spec/contracts.yaml'] },
  { path: 'frontend/src/components/UserCard.tsx', deps: ['frontend/src/api/client.ts'] },
  { path: 'frontend/src/pages/Profile.tsx', deps: ['frontend/src/components/UserCard.tsx'] },
  { path: 'frontend/src/pages/Orders.tsx', deps: ['frontend/src/api/client.ts'] },
]

const BEFORE = `GET /users/{id}:
  response:
    id: int
    name: string
    email: string
`
const AFTER = `GET /users/{id}:
  response:
    id: int
    first_name: string
    last_name: string
    email: string
`
const CARD_BEFORE = `export function UserCard({ user }) {
  return <h2>{user.name}</h2>
}
`
const CARD_AFTER = `export function UserCard({ user }) {
  return <h2>{user.first_name} {user.last_name}</h2>
}
`

// Multiply all delays; raise to slow the story down (e.g. ?speed=2).
const SPEED = Number(new URLSearchParams(location.search).get('speed') ?? 1.5)

const up = (id, patch) => ({ type: 'agent.upsert', data: { id, ...patch } })

const SCRIPT = [
  [0, { type: 'snapshot', data: { agents: AGENTS, files: FILES, claims: [], proposals: [], alerts: [], events: [] } }],
  [1200, up('alice', { status: 'editing' })],
  [300, { type: 'claim.add', data: { agentId: 'alice', path: 'backend/api/users.py', intent: 'Return first_name/last_name' } }],
  [300, { type: 'file.touch', data: { agentId: 'alice', path: 'backend/api/users.py' } }],
  [1200, up('bob', { status: 'editing' })],
  [300, { type: 'claim.add', data: { agentId: 'bob', path: 'frontend/src/components/UserCard.tsx', intent: 'Render user name in card' } }],
  [300, { type: 'file.touch', data: { agentId: 'bob', path: 'frontend/src/components/UserCard.tsx' } }],
  [1200, up('carol', { status: 'editing' })],
  [300, { type: 'claim.add', data: { agentId: 'carol', path: 'backend/models.py', intent: 'Add Order.history relation' } }],
  [300, { type: 'file.touch', data: { agentId: 'carol', path: 'backend/models.py' } }],
  [2000, {
    type: 'proposal.add',
    data: {
      id: 'p1', agentId: 'alice', title: 'Split `name` into `first_name` / `last_name`', target: 'spec/contracts.yaml',
      rationale: 'Needed for localized greetings.', before: BEFORE, after: AFTER, affects: ['bob'],
    },
  }],
  [1800, {
    type: 'alert.add',
    data: {
      id: 'a1', type: 'drift', severity: 'high', agents: ['alice', 'bob'],
      files: ['spec/contracts.yaml', 'backend/api/users.py', 'frontend/src/components/UserCard.tsx'],
      message: "Bob's UserCard reads `user.name`, which Alice's pending contract change removes.",
      suggestion: 'Notify Bob to render first_name + last_name before merging.',
    },
  }],
  [600, up('bob', { status: 'blocked' })],
  [2200, { type: 'file.touch', data: { agentId: 'carol', path: 'backend/api/users.py' } }],
  [800, {
    type: 'alert.add',
    data: {
      id: 'a2', type: 'collision', severity: 'high', agents: ['alice', 'carol'], files: ['backend/api/users.py'],
      message: 'Carol started editing users.py, which Alice has claimed.',
      suggestion: 'Carol should wait for Alice, or move the order join into orders.py.',
    },
  }],
  [2500, { type: 'file.touch', data: { agentId: 'carol', path: 'backend/api/orders.py' } }],
  [300, { type: 'claim.add', data: { agentId: 'carol', path: 'backend/api/orders.py', intent: 'Order join lives here instead' } }],
  [300, { type: 'alert.resolve', data: { id: 'a2' } }],
  [1500, { type: 'proposal.update', data: { id: 'p1', status: 'accepted' } }],
  [1200, up('bob', { status: 'editing', task: 'Adapt UserCard to first/last name' })],
  [800, {
    type: 'proposal.add',
    data: {
      id: 'p2', agentId: 'bob', title: 'UserCard: render first + last name', target: 'frontend/src/components/UserCard.tsx',
      rationale: 'Adapting to accepted contract change p1.', before: CARD_BEFORE, after: CARD_AFTER, affects: [],
    },
  }],
  [1500, { type: 'alert.resolve', data: { id: 'a1' } }],
  [1500, { type: 'proposal.update', data: { id: 'p2', status: 'accepted' } }],
  [600, up('alice', { status: 'idle' })],
  [300, { type: 'claim.release', data: { agentId: 'alice', path: 'backend/api/users.py' } }],
  [8000, null], // pause before looping
]

// Returns a stop function that halts the replay and wipes placeholder state.
export function startMock() {
  const { apply, setMock } = useStore.getState()
  let i = 0
  let timer
  let running = true
  setMock(true)
  const step = () => {
    const [, msg] = SCRIPT[i]
    if (msg) apply(msg)
    i = (i + 1) % SCRIPT.length
    timer = setTimeout(step, SCRIPT[i][0] * SPEED)
  }
  step()
  return () => {
    if (!running) return
    running = false
    clearTimeout(timer)
    setMock(false)
    apply({ type: 'snapshot', data: {} })
  }
}
