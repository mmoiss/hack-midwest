// Consumer of both seeded contracts (GET /users/{id}, GET /orders).
export type User = { id: number; name: string; email: string }
export type Order = { id: number; user_id: number; total: number }

export async function getUser(id: number): Promise<User> {
  const res = await fetch(`/users/${id}`)
  return res.json()
}

export async function listOrders(): Promise<{ orders: Order[] }> {
  const res = await fetch("/orders")
  return res.json()
}
