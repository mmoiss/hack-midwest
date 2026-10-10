// Consumer of GET /orders (spec entry seeded by backend/seed.py).
import type { Order } from "../api/client"

export function Orders({ orders }: { orders: Order[] }) {
  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>Order #{o.id} — ${o.total.toFixed(2)}</li>
      ))}
    </ul>
  )
}
