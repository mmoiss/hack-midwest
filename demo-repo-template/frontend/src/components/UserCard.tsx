// The consumer of GET /users/{id} (spec entry seeded by backend/seed.py).
import type { User } from "../api/client"

export function UserCard({ user }: { user: User }) {
  return (
    <div className="user-card">
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  )
}
