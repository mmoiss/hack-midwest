# Spec (human-readable mirror — NOT the source of truth)

The source of truth is the `spec` table in `coordinator.db`, hand-seeded by `backend/seed.py`. This file just mirrors it for anyone reading the demo repo directly.

| Contract | Owner | Consumers | Shape |
|---|---|---|---|
| `GET /users/{id}` | `backend/api/users.py` | `frontend/src/api/client.ts`, `frontend/src/components/UserCard.tsx` | `{id: int, name: string, email: string}` |
| `GET /orders` | `backend/api/orders.py` | `frontend/src/api/client.ts`, `frontend/src/pages/Orders.tsx` | `{orders: Order[]}` |

Catching drift never rewrites this table on its own — only `propose_spec_change`, routed to a human, does that.
