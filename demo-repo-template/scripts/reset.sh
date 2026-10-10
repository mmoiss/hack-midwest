#!/usr/bin/env bash
# Reset demo-repo's files to tag demo-seed and wipe the server's claims/events
# rows, then re-establish the two claims the scripted demo moment depends on.
# Never touches the spec table (hand-seeded once by backend/seed.py).
#
# Why re-seed claims at all: confirmed by a real local run (see INTEGRATION_TEST.md,
# finding 3) that the coordinator resolves an alert's `affected` field against
# whoever currently holds a claim on the consumer file. Skip this and the live
# pitch depends on the on-stage agent happening to call declare_intent itself,
# in the right order, before the scripted breaking edit -- one more thing that
# can go wrong live for no reason, when it's otherwise fully deterministic.
# Set SKIP_CLAIM_SEED=1 to get the old bare-wipe behavior back.
set -euo pipefail
DEMO_REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEMO_REPO"

echo "Resetting files to tag demo-seed..."
git reset --hard demo-seed
git clean -fd

echo "Wiping claims/events rows (spec table untouched)..."
# Confirmed against backend/mcp.py: it reads DB_PATH (default "coordinator.db", a
# relative path) and must be run as `python -m backend.mcp` from the repo root --
# that's what the Dockerfile's CMD does too. So the unset-env-var local default is
# <repo-root>/coordinator.db, not backend/coordinator.db (an earlier guess here was
# wrong about this). Deployed, compose.yaml pins DB_PATH to the absolute
# /app/data/coordinator.db, which is why this still checks the env var first: running
# this against a remote/container DB means passing that path in explicitly.
#
# This DB-wipe half only applies to a server you're running locally for rehearsal.
# Once hooks point at the real deployed /events (see SETUP.md), there is no local
# coordinator.db to find, and that's correct, not an error -- handled below rather
# than failing the whole script on a missing file or a freshly-created empty one.
DB_PATH="${DB_PATH:-${COORDINATOR_DB_PATH:-$DEMO_REPO/../coordinator.db}}"
echo "Using DB_PATH=$DB_PATH"
python3 - "$DB_PATH" <<'PY'
import os
import sqlite3
import sys

path = sys.argv[1]
if not os.path.exists(path):
    print(f"No coordinator.db at {path} -- nothing to wipe "
          f"(expected if you haven't run the server locally, or hooks already point at the real one).")
    sys.exit(0)

conn = sqlite3.connect(path)
try:
    conn.execute("DELETE FROM claims")
    conn.execute("DELETE FROM events")
    conn.commit()
    print(f"Wiped claims/events in {path}")

    if os.environ.get("SKIP_CLAIM_SEED"):
        print("SKIP_CLAIM_SEED set -- leaving claims empty.")
    else:
        # Matches backend/seed.py's own alice/bob rows exactly. Pre-established here,
        # not left for a live agent to declare_intent on stage: the scripted drift
        # moment only resolves to a teammate's name, not a raw file path, if the
        # claim already exists when the breaking edit happens.
        conn.executemany(
            "INSERT INTO claims (agent, file, summary, claimed_at) VALUES (?, ?, ?, datetime('now'))",
            [
                ("alice", "backend/api/users.py", "Owns GET /users/{id}"),
                ("bob", "frontend/src/components/UserCard.tsx", "Renders user name and email"),
            ],
        )
        conn.commit()
        print("Re-seeded alice/bob's claims so the scripted drift moment resolves by name.")
except sqlite3.OperationalError as e:
    print(f"{path} exists but isn't a seeded coordinator.db yet ({e}) -- nothing to wipe.")
finally:
    conn.close()
PY
echo "Reset complete."
