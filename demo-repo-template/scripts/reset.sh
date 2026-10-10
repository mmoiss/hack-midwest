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
# TODO(confirm with Server track): real coordinator.db path.
DB_PATH="${COORDINATOR_DB_PATH:-$DEMO_REPO/../backend/coordinator.db}"
python3 - "$DB_PATH" <<'PY'
import sqlite3
import sys

conn = sqlite3.connect(sys.argv[1])
conn.execute("DELETE FROM claims")
conn.execute("DELETE FROM events")
conn.commit()
conn.close()
print(f"Wiped claims/events in {sys.argv[1]}")
PY
echo "Reset complete."
