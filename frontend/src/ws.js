import { useStore } from './store'

// Defaults to same-origin /ws (proxied to FastAPI in dev, Caddy in prod).
const WS_URL = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// Connects to the backend feed and reconnects with backoff. The backend should
// send a `snapshot` first on every (re)connect, then incremental events.
// `onFirstOpen` runs once, before any backend message (used to drop placeholders).
export function connectLive(url = WS_URL, onFirstOpen) {
  const { apply, setConnection } = useStore.getState()
  let ws
  let retry = 0
  let stopped = false

  const open = () => {
    setConnection('connecting')
    ws = new WebSocket(url)
    ws.onopen = () => {
      onFirstOpen?.()
      onFirstOpen = null
      retry = 0
      setConnection('live')
    }
    ws.onmessage = (e) => {
      try {
        apply(JSON.parse(e.data))
      } catch (err) {
        console.error('bad message', e.data, err)
      }
    }
    ws.onclose = () => {
      if (stopped) return
      setConnection('offline')
      setTimeout(open, Math.min(1000 * 2 ** retry++, 10000))
    }
  }
  open()
  return () => {
    stopped = true
    ws?.close()
  }
}
