// Decorative filler node for the dashboard's codebase map; not wired to any spec entry.
import { Profile } from "./pages/Profile"

export function App() {
  return <Profile user={{ id: 1, name: "Ada Lovelace", email: "ada@example.com" }} />
}
