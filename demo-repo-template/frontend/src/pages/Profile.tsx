// Decorative filler node for the dashboard's codebase map; not wired to any spec entry.
import { UserCard } from "../components/UserCard"
import type { User } from "../api/client"

export function Profile({ user }: { user: User }) {
  return <UserCard user={user} />
}
