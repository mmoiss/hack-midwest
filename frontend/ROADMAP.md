# Frontend Roadmap - Skeg

**Goal:** a dashboard that explains the demo with no narration. Two agents get conflicting tasks, the map flashes, and one agent adapts.

**Stack:** React 19, Vite, Tailwind v4, React Flow (`@xyflow/react`), zustand, jsdiff.

## Run it

```bash
cd frontend
npm install
npm run dev                      # connects to FastAPI on localhost:8000 via the Vite proxy
```

- No config needed. The dashboard calls same-origin `/ws` and `/api`, and Vite proxies them to `localhost:8000` (Caddy does the same in production).
- If the backend runs elsewhere, copy `.env.example` to `.env` and set `VITE_WS_URL` / `VITE_API_URL`.

---

## Layout

```
┌──────────────────────────── TopBar: LIVE/OFFLINE · agents · claims · pending · alerts ─┐
│ Agents panel  │        Codebase map (React Flow)          │ Tabs: Changes│Alerts│Feed │
│ color · tool  │  file nodes = color stripes per claimant  │ proposal → diff + accept │
│ status · task │  pulsing initials = agent editing now     │ alert cards + resolve    │
│ current file  │  red ring = collision, amber = drift      │ raw event log            │
│ (hover = spot-│  dashed dep edges, animated amber on drift│                          │
│  light files) │  [ALERT BANNER flashes over map]          │                          │
└───────────────┴───────────────────────────────────────────┴──────────────────────────┘
```

## Feature → file map

| Feature | Where | Status |
|---|---|---|
| Codebase map (tree layout, deps, drag, minimap) | `src/components/CodebaseMap.tsx` | ✅ |
| Agent colors (stripes, markers, hover spotlight) | `Sidebar.tsx`, `AgentPage.tsx`, `CodebaseMap.tsx` | ✅ |
| Proposed changes page with a diff for each change | `Lists.tsx` → `Changes`, `Diff` | ✅ |
| Collision and drift signals (rings, banner, cards) | `CodebaseMap.tsx`, `AlertBanner.tsx`, `Lists.tsx` → `Alerts` | ✅ |
| Live event feed | `Lists.tsx` → `Feed` | ✅ |
| Sidebar navigation and overview landing page | `Sidebar.tsx`, `Overview.tsx` | ✅ |
| WebSocket client with reconnect | `src/ws.js` | ✅ |
| State + event reducer | `src/store.ts` | ✅ |

---

## Contract with the backend (agree on this first)

The full schema is at the top of `src/store.ts`.

**WebSocket `/ws`.** The server sends `snapshot` on connect, then one message per event. Every message has the shape `{type, data, ts}`.

| type | data |
|---|---|
| `snapshot` | `{agents[], files[], claims[], proposals[], alerts[], events[]}` |
| `agent.upsert` | `{id, name, owner, tool, color, status: editing\|idle\|blocked, task, currentFile}` |
| `file.add` | `{path, deps?: string[]}` |
| `file.touch` | `{agentId, path}` |
| `claim.add` / `claim.release` | `{agentId, path, intent?}` |
| `proposal.add` | `{id, agentId, title, target, rationale, before, after, affects[]}` |
| `proposal.update` | `{id, status: pending\|accepted\|rejected}` |
| `alert.add` | `{id, type: collision\|drift, severity, agents[], files[], message, suggestion}` |
| `alert.resolve` | `{id}` |

**REST (human decisions):**

- `POST /api/proposals/{id}` with body `{status}`
- `POST /api/alerts/{id}/resolve`

The backend applies each decision, then broadcasts the resulting event, so every open dashboard stays in sync.

**Colors:** the dashboard assigns each agent a color from its own warm palette in registration order (`PALETTE` in `store.ts`) and ignores the backend's `color` field, so the scheme stays consistent no matter what tokens are configured.

**Diffs:** proposals send the full `before` and `after` text, and the frontend computes the diff. This means the backend never has to produce unified diffs.

---

## Phases (24h)

### Phase 0: Planning (tonight; no code because of the fresh-code rule)
- [ ] Agree on the event contract above with the backend teammate. It is the only coupling between frontend and backend.
- [ ] Choose the demo repo: a real small fullstack app whose file tree looks good on the map (fewer than 30 files).
- [ ] Write the demo script: who does what, and the conflicting tasks.

### Phase 1: Skeleton (hours 0–3) ✅ *done in this scaffold*
- [x] Vite, Tailwind, and React Flow app with a 3-column layout
- [x] zustand store with a pure reducer for every event type
- [x] Defensive defaults in the reducer, so partial backend messages can't crash the UI

### Phase 2: Wire to the real backend (hours 3–8)
- [ ] Point `VITE_WS_URL` at the Linode stub as soon as it exists. Run `snapshot` and one other event end to end.
- [ ] Build the `file.add` flow: the backend scans the demo repo and sends `snapshot.files`, plus `deps` if import parsing is cheap (otherwise skip `deps`).
- [ ] Hook the Accept/Reject and Resolve buttons to the REST endpoints.
- [ ] Test reconnect: kill the backend and confirm the OFFLINE pill and auto-reconnect.

### Phase 3: Demo polish (hours 8–16)
- [ ] Alert sound on `alert.add`. A short beep is fine; the room needs to *hear* the catch.
- [ ] Zoom the camera to the affected files when an alert fires (`fitView({ nodes })`).
- [ ] Show the "agent adapted" moment: a green check animation when an alert resolves because an agent changed course.
- [ ] Show an agent's intent text in a tooltip when hovering a claimed node.
- [ ] Make it fit a 1080p projector: test font sizes from the back of the room and bump `text-xs` up if needed.
- [ ] Add a spec panel *(optional)*: a read-only view of `contracts.yaml` with the pending change highlighted.

### Phase 4: Deploy + rehearse (hours 16–22)
- [ ] Run `npm run build` and have Caddy serve `frontend/dist` on the same Linode, with `/api` and `/ws` reverse-proxied to FastAPI.
- [ ] Rehearse the full two-laptop demo 3 or more times. Run the backend on the presenting laptop as a fallback if the venue network dies.
- [ ] Record a screen capture of a clean run as a last-resort backup.

### Phase 5: Buffer (hours 22–24)
- [ ] Only bug fixes. No new features.

---

## Cut list (do not build)
Auth, routing or multiple pages, multi-repo support, an editable spec UI, persisting UI state, mobile layout, a light theme, and tests beyond clicking through the demo.

## Risks
| Risk | Mitigation |
|---|---|
| The backend isn't ready when the frontend needs it | Feed it hand-written events from a tiny test script that sends WebSocket messages |
| The real repo tree is too big for the map | Have the backend send only the demo-relevant dirs, or collapse dirs past depth 3 |
| The event shape doesn't match | The reducer ignores unknown types; check the Feed tab, which shows raw types |
| The venue network fails during the demo | Run the backend and both agents on localhost, plus a recorded video backup |
