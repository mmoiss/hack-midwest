#!/usr/bin/env bash
# Reset demo-repo's files to tag demo-seed and wipe the server's claims/events
# rows. Never touches the spec table (hand-seeded once by backend/seed.py).
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
except sqlite3.OperationalError as e:
    print(f"{path} exists but isn't a seeded coordinator.db yet ({e}) -- nothing to wipe.")
finally:
    conn.close()
PY
echo "Reset complete."
