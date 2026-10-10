import { useStore } from './store'

// Defaults to same-origin /api/stream (server.ts, mounted inside Vite in dev).
const STREAM_URL = import.meta.env.VITE_STREAM_URL ?? '/api/stream'

// Subscribes to the dashboard server's SSE feed. The server sends a `snapshot`
// on every (re)connect, then incremental events. EventSource reconnects itself.
export function connectLive(url = STREAM_URL) {
  const { apply, setConnection } = useStore.getState()
  setConnection('connecting')
  const es = new EventSource(url)
  es.onopen = () => setConnection('live')
  es.onerror = () => setConnection('offline')
  es.onmessage = (e) => {
    try {
      apply(JSON.parse(e.data))
    } catch (err) {
      console.error('bad message', e.data, err)
    }
  }
  return () => es.close()
}
