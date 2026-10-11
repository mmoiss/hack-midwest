// server.ts translation of human decisions: proposal_decision / alert_resolved event rows
// (written by backend/mcp.py's /api routes) must reach the browser as proposal.update /
// alert.resolve, and a fresh snapshot must already carry the resulting statuses.
//   npm test   (node --test; needs Node 22.13+ for node:sqlite)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { snapshot, translate } from '../server.ts'

const SHAPE = '{\n  "id": "int",\n  "name": "string",\n  "email": "string"\n}'
const NEW_SHAPE = '{\n  "id": "int",\n  "first_name": "string",\n  "last_name": "string",\n  "email": "string"\n}'

// In-memory copy of backend/seed.py's demo state, trimmed to what these cases need.
function seeded() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE spec (contract TEXT PRIMARY KEY, owner TEXT NOT NULL, consumers TEXT NOT NULL, shape TEXT NOT NULL);
    CREATE TABLE claims (agent TEXT NOT NULL, file TEXT NOT NULL, summary TEXT, claimed_at TEXT NOT NULL, PRIMARY KEY (agent, file));
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), agent TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, delivered_to TEXT NOT NULL DEFAULT '[]');
  `)
  db.prepare('INSERT INTO spec VALUES (?, ?, ?, ?)').run('GET /users/{id}', 'backend/api/users.py', JSON.stringify(['frontend/src/api/client.ts', 'frontend/src/components/UserCard.tsx']), SHAPE)
  const claim = db.prepare("INSERT INTO claims VALUES (?, ?, ?, datetime('now', ?))")
  claim.run('aruneem', 'backend/api/users.py', 'Return first_name/last_name', '-2 minutes')
  claim.run('matthew', 'frontend/src/components/UserCard.tsx', 'Render user name in card', '-1 minutes')
  claim.run('matthew', 'frontend/src/pages/Orders.tsx', 'List orders', '+0 minutes')
  const ev = db.prepare('INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)')
  ev.run('aruneem', 'propose_spec_change', JSON.stringify({ entry: 'GET /users/{id}', change: NEW_SHAPE, reason: 'Localized greetings' })) // id 1
  ev.run('coordinator', 'alert', JSON.stringify({ summary: 'UserCard reads name', affected: ['matthew'], suggested_fix: 'Render first_name + last_name' })) // id 2
  ev.run('coordinator', 'alert', JSON.stringify({ question: 'Is dropping email intended?', escalated: true })) // id 3
  return db
}
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM events ORDER BY id').all() as any[]

test('a fresh snapshot shows pending proposals, open alerts, derived task and affects', () => {
  const db = seeded()
  const snap = snapshot(db, rows(db))
  assert.deepEqual(snap.agents.map((a) => [a.id, a.task]), [['aruneem', 'Return first_name/last_name'], ['matthew', 'List orders']])
  assert.ok(!snap.agents.some((a) => a.id === 'coordinator'), 'the coordinator reviews edits but is not a crew member')
  assert.equal(snap.proposals.length, 1)
  assert.equal(snap.proposals[0].status, undefined, 'store.ts defaults an undecided proposal to pending')
  assert.deepEqual(snap.proposals[0].affects, ['matthew'], 'whoever claimed a consumer file, minus the proposer')
  assert.deepEqual(snap.alerts.map((a) => [a.id, a.type, a.status, a.severity]), [['3', 'escalation', 'open', undefined], ['2', 'drift', 'open', undefined]])
})

test('decision rows translate to proposal.update / alert.resolve and fold into the snapshot', () => {
  const db = seeded()
  // What backend/mcp.py writes on Accept: the spec now holds the new shape, and the
  // decision row remembers the old one.
  db.prepare('UPDATE spec SET shape = ? WHERE contract = ?').run(NEW_SHAPE, 'GET /users/{id}')
  db.prepare('INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)').run('human', 'proposal_decision', JSON.stringify({ proposal_id: 1, status: 'accepted', entry: 'GET /users/{id}', previous_shape: SHAPE, shape: NEW_SHAPE }))
  db.prepare('INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)').run('matthew', 'alert_resolved', JSON.stringify({ alert_id: 2 }))
  const all = rows(db)

  assert.deepEqual(translate(db, all[3]), [{ type: 'proposal.update', data: { id: '1', status: 'accepted', by: 'human', title: 'GET /users/{id}', before: SHAPE } }])
  assert.deepEqual(translate(db, all[4]), [{ type: 'alert.resolve', data: { id: '2', by: 'matthew' } }])

  const snap = snapshot(db, all)
  assert.equal(snap.proposals[0].status, 'accepted')
  assert.equal(snap.proposals[0].before, SHAPE, 'diff still shows what changed, even though spec.shape now equals the proposal')
  assert.equal(snap.proposals[0].after, NEW_SHAPE)
  assert.deepEqual(snap.alerts.map((a) => [a.id, a.status]), [['3', 'open'], ['2', 'resolved']])
  assert.ok(!snap.agents.some((a) => a.id === 'human'), 'the dashboard user is not a crew member')
  assert.equal(snap.events[0].type, 'alert.resolve', 'decisions appear in the feed, newest first')
})

test('a rejected proposal keeps its original before/after', () => {
  const db = seeded()
  db.prepare('INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)').run('human', 'proposal_decision', JSON.stringify({ proposal_id: 1, status: 'rejected', entry: 'GET /users/{id}' }))
  const snap = snapshot(db, rows(db))
  assert.equal(snap.proposals[0].status, 'rejected')
  assert.equal(snap.proposals[0].before, SHAPE)
})
