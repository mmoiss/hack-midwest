import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createStream, snapshot, translate } from '../server.ts'
import { edgeAlerts } from '../src/alertGraph.ts'

Object.assign(globalThis, { matchMedia: () => ({ matches: false }) })
const { useStore, alertTargets } = await import('../src/store.ts')

function seed(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE spec (contract TEXT PRIMARY KEY, owner TEXT, consumers TEXT, shape TEXT);
    CREATE TABLE claims (agent TEXT, file TEXT, summary TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), agent TEXT, type TEXT, payload TEXT);
  `)
  db.prepare('INSERT INTO spec VALUES (?, ?, ?, ?)').run('GET /inventory', 'service/stock.py', '["web/Stock.tsx"]', '{}')
  db.prepare('INSERT INTO claims VALUES (?, ?, ?)').run('builder', 'unrelated/Settings.tsx', 'Unrelated work')
}

function append(db: DatabaseSync, type: string, payload: object) {
  const result = db.prepare('INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)').run('reviewer', type, JSON.stringify(payload))
  return Number(result.lastInsertRowid)
}

const context = { contract: 'GET /inventory', owner: 'service/stock.py', consumers: ['web/Stock.tsx'] }

test('recorded context survives spec changes, excludes unrelated claims and clears edge highlights on resolution', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    const edit_id = append(db, 'edit', { file: context.owner, diff: '-quantity' })
    append(db, 'alert', { ...context, edit_id, summary: 'Quantity removed', affected: ['builder'] })
    db.prepare('UPDATE spec SET owner = ?, consumers = ?').run('new/stock.py', '["new/Stock.tsx"]')
    useStore.getState().apply({ type: 'snapshot', data: snapshot(db, db.prepare('SELECT * FROM events').all() as any) })
    const state = useStore.getState()
    const alert = state.alerts[0]
    assert.equal(alert.editId, String(edit_id))
    assert.equal(alert.owner, context.owner)
    assert.deepEqual(alert.consumers, context.consumers)
    assert.deepEqual(alertTargets(state, alert).files.sort(), [context.owner, ...context.consumers].sort())
    assert.deepEqual(state.files.find((f) => f.path === 'web/Stock.tsx')?.deps, [context.owner])
    assert.equal(edgeAlerts(state.alerts, context.owner, 'web/Stock.tsx').length, 1)
    assert.equal(edgeAlerts(state.alerts, context.owner, 'unrelated/Settings.tsx').length, 0)
    state.focusAlert(alert.id)
    assert.equal(useStore.getState().page, 'map')
    assert.equal(useStore.getState().selectedAlert, alert.id)
    useStore.getState().apply({ type: 'alert.resolve', data: { id: alert.id } })
    assert.equal(edgeAlerts(useStore.getState().alerts, context.owner, 'web/Stock.tsx').length, 0)
  } finally { db.close() }
})

test('explicit origins resolve context; legacy alerts never guess from timing or claims', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    const edit_id = append(db, 'edit', { file: context.owner })
    append(db, 'edit', { file: 'other/latest.py' })
    const linked = append(db, 'alert', { edit_id, question: 'Accept the new shape?', escalated: true })
    const legacy = append(db, 'alert', { summary: 'Old alert', affected: ['builder'] })
    const translateId = (id: number) => translate(db, db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any)[0].data
    assert.equal(translateId(linked).owner, context.owner)
    assert.equal(translateId(linked).contract, context.contract)
    assert.equal(translateId(linked).message, 'Accept the new shape?')
    assert.equal(translateId(linked).type, 'decision')
    assert.equal(translateId(legacy).owner, undefined)
    assert.deepEqual(translateId(legacy).files, [])
    // A file that owns multiple contracts is not sufficient to guess which broke.
    db.prepare('INSERT INTO spec VALUES (?, ?, ?, ?)').run('POST /inventory', context.owner, '[]', '{}')
    assert.equal(translateId(linked).contract, undefined)
    assert.deepEqual(translateId(linked).consumers, [])
  } finally { db.close() }
})

test('configured SQLite -> live SSE -> store -> reconnect preserves dynamic map targets', { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'skeg-alert-test-'))
  const dbPath = join(directory, 'shared.db')
  const writer = new DatabaseSync(dbPath)
  const server = createServer(createStream('{}', dbPath))
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  async function connect() {
    const response = await fetch(`http://127.0.0.1:${port}/api/stream`)
    assert.equal(response.status, 200)
    const reader = response.body!.getReader()
    readers.push(reader)
    let pending = ''
    const decoder = new TextDecoder()
    return async (type: string) => {
      for (;;) {
        let boundary: number
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const chunk = pending.slice(0, boundary)
          pending = pending.slice(boundary + 2)
          const msg = JSON.parse(chunk.slice('data: '.length))
          useStore.getState().apply(msg)
          if (msg.type === type) return msg
        }
        const chunk = await reader.read()
        assert.equal(chunk.done, false)
        pending += decoder.decode(chunk.value, { stream: true })
      }
    }
  }
  try {
    const unavailable = await fetch(`http://127.0.0.1:${port}/api/stream`)
    assert.equal(unavailable.status, 503)
    await unavailable.text()
    seed(writer)
    const next = await connect()
    await next('snapshot')
    const edit_id = append(writer, 'edit', { file: 'services/billing.py', diff: '-total' })
    const payload = { contract: 'POST /invoices', owner: 'services/billing.py', consumers: ['mobile/Invoice.tsx', 'reports/export.py'], edit_id, summary: 'Total missing' }
    const id = append(writer, 'alert', payload)
    const live = await next('alert.add')
    assert.equal(live.data.editId, String(edit_id))
    assert.equal(typeof live.ts, 'number')
    assert.deepEqual(useStore.getState().files.find((f) => f.path === 'mobile/Invoice.tsx')?.deps, [payload.owner])
    assert.equal(useStore.getState().selectedAlert, String(id))
    const reconnect = await connect()
    await reconnect('snapshot')
    const restored = useStore.getState().alerts.find((a) => a.id === String(id))!
    assert.deepEqual(restored.consumers, payload.consumers)
    assert.equal(restored.editId, String(edit_id))
    assert.equal(edgeAlerts([restored], payload.owner, payload.consumers[1]).length, 1)
  } finally {
    await Promise.all(readers.map((reader) => reader.cancel()))
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
    writer.close()
    // Windows may hold WAL files until the server's request-close handlers finish.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
