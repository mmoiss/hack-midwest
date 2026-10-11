"""Run the coordinator against a hand-written fixture.

No live /events, no demo repo, no Akamai account required if
COORDINATOR_MODEL_PROVIDER is set to a stand-in (anthropic/openai/ollama/bedrock).
Writes to coordinator_fixture.db by default so it never touches the real
server's database.

Seeds one claim (matthew on UserCard.tsx, matching demo-repo/scripts/reset.sh's demo
claims) so run_coordinator's claims-table lookup has something to resolve --
otherwise `affected` would fall back to the raw consumer file path.

Usage:
    python backend/run_fixture.py drop_email
    python backend/run_fixture.py noop
    python backend/run_fixture.py drop_email --structured
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

os.environ.setdefault("COORDINATOR_DB_PATH", "coordinator_fixture.db")

sys.path.insert(0, str(Path(__file__).parent))
from coordinator import DB_PATH, _ensure_schema, run_coordinator  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"

CASES = {
    "drop_email": "diff_drop_email.diff",
    "noop": "diff_noop.diff",
}


def seed_claims() -> None:
    claims = json.loads((FIXTURES / "claims.json").read_text())
    conn = sqlite3.connect(DB_PATH)
    _ensure_schema(conn)
    conn.execute("DELETE FROM claims")
    conn.executemany(
        "INSERT INTO claims (agent, file, summary, claimed_at) VALUES (?, ?, ?, datetime('now'))",
        [(c["agent"], c["file"], c["summary"]) for c in claims],
    )
    conn.commit()
    conn.close()


def main(case: str, structured: bool) -> None:
    seed_claims()

    diff = (FIXTURES / CASES[case]).read_text()
    spec_entry = json.loads((FIXTURES / "spec_users.json").read_text())

    run_coordinator(diff, spec_entry, structured=structured)

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, ts, agent, type, payload FROM events ORDER BY id DESC LIMIT 5").fetchall()
    conn.close()
    print("\nLatest events in", DB_PATH)
    for row in rows:
        print(row)


if __name__ == "__main__":
    args = sys.argv[1:]
    structured = "--structured" in args
    args = [a for a in args if a != "--structured"]
    main(args[0] if args else "drop_email", structured)
