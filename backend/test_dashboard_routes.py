"""Tests for the dashboard's human-decision routes in backend/mcp.py.

    python -m pytest backend/test_dashboard_routes.py      # from the repo root
    python -m backend.test_dashboard_routes                # same, without pytest

Runs the FastMCP app in-process against a throwaway SQLite file holding seed.py's two
contracts plus the few claims/events the cases need, so no server, token file or model
key is required. The point of
these: Accept is the only thing allowed to rewrite spec.shape (CONTRACT.md), and a resolved
alert must stop reaching agents through /events and check_conflicts.
"""

import importlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
TOKENS = {"tok_aruneem": {"name": "aruneem", "color": "#c8794a"}, "tok_matthew": {"name": "matthew", "color": "#7a9a6e"}}


SPLIT_SHAPE = json.dumps({"id": "int", "first_name": "string", "last_name": "string", "email": "string"}, indent=2)


def seed(db_path: str) -> None:
    """backend/seed.py's contracts, plus the rows these cases refer to by id.

    ids: 7 = aruneem's proposal for GET /users/{id}; 8 = alert naming aruneem+matthew;
    10 = alert naming aruneem+sandi. seed.py itself writes no claims or events.
    """
    import runpy

    os.environ["DB_PATH"] = db_path
    runpy.run_path(str(ROOT / "backend" / "seed.py"), run_name="__main__")
    conn = sqlite3.connect(db_path)
    conn.executemany(
        "INSERT INTO claims VALUES (?, ?, ?, datetime('now'))",
        [("aruneem", "backend/api/users.py", "Return first_name/last_name"), ("matthew", "frontend/src/components/UserCard.tsx", "Render user name in card")],
    )
    rows = {
        7: ("aruneem", "propose_spec_change", {"entry": "GET /users/{id}", "change": SPLIT_SHAPE, "reason": "Needed for localized greetings."}),
        8: ("coordinator", "alert", {"summary": "Matthew's UserCard reads `user.name`, which Aruneem's pending contract change removes.", "affected": ["aruneem", "matthew"], "suggested_fix": "Render first_name + last_name."}),
        10: ("coordinator", "alert", {"summary": "Sandi started editing users.py, which Aruneem has claimed.", "affected": ["aruneem", "sandi"], "suggested_fix": "Wait for Aruneem."}),
    }
    conn.executemany(
        "INSERT INTO events (id, agent, type, payload) VALUES (?, ?, ?, ?)",
        [(i, a, t, json.dumps(p)) for i, (a, t, p) in rows.items()],
    )
    conn.commit()
    conn.close()


class DashboardRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)  # Windows: SQLite may still hold the file
        cls.db = os.path.join(cls.tmp.name, "coordinator.db")
        seed(cls.db)
        os.environ["TEAM_TOKENS"] = json.dumps(TOKENS)
        os.environ["COORDINATOR_DB_PATH"] = cls.db
        sys.path.insert(0, str(ROOT))
        import backend.mcp as mcp

        cls.mcp = importlib.reload(mcp)  # pick up DB_PATH / TEAM_TOKENS set above
        cls.mcp.init_db()
        cls.client = TestClient(cls.mcp.mcp.http_app())
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.tmp.cleanup()

    def shape(self, contract: str) -> str:
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute("SELECT shape FROM spec WHERE contract = ?", (contract,)).fetchone()[0]
        finally:
            conn.close()

    def events(self, *types: str) -> list[tuple]:
        conn = sqlite3.connect(self.db)
        try:
            q = ",".join("?" for _ in types)
            return conn.execute(f"SELECT id, agent, type, payload FROM events WHERE type IN ({q}) ORDER BY id", types).fetchall()
        finally:
            conn.close()

    def hook(self, token: str) -> list[dict]:
        r = self.client.post("/events", json={"agent": "x", "file": "README.md", "diff": ""}, headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 200)
        return r.json()["alerts"]

    def test_0_pending_proposal_lookup(self):
        # Proposal 7 is for GET /users/{id} and nobody has decided it yet.
        pending = self.mcp.pending_proposal_for("GET /users/{id}")
        self.assertEqual((pending["id"], pending["agent"]), (7, "aruneem"))
        self.assertIn("first_name", pending["change"])
        self.assertIsNone(self.mcp.pending_proposal_for("GET /orders"))

    def test_1_validation(self):
        self.assertEqual(self.client.post("/api/proposals/7", json={"status": "maybe"}).status_code, 400)
        self.assertEqual(self.client.post("/api/proposals/7", content=b"not json").status_code, 400)
        self.assertEqual(self.client.post("/api/proposals/999", json={"status": "accepted"}).status_code, 404)
        self.assertEqual(self.client.post("/api/proposals/8", json={"status": "accepted"}).status_code, 404, "8 is an alert, not a proposal")
        self.assertEqual(self.client.post("/api/alerts/7/resolve").status_code, 404, "7 is a proposal, not an alert")
        self.assertEqual(self.client.post("/api/alerts/nope/resolve").status_code, 404)
        self.assertEqual(self.events("alert_resolved", "proposal_decision"), [], "nothing logged for rejected input")

    def test_2_resolve_alert_stops_delivery(self):
        # Alert 8 names aruneem and matthew; alert 10 names aruneem and sandi. matthew gets 8 first.
        self.assertEqual([a["affected"] for a in self.hook("tok_matthew")], [["aruneem", "matthew"]])

        r = self.client.post("/api/alerts/8/resolve")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"id": 8, "status": "resolved", "by": "human"})
        r = self.client.post("/api/alerts/8/resolve")
        self.assertEqual(r.json().get("already"), True, "second resolve is idempotent")
        r = self.client.post("/api/alerts/10/resolve", headers={"Authorization": "Bearer tok_matthew"})
        self.assertEqual(r.json()["by"], "matthew", "a teammate's token attributes the decision")

        self.assertEqual(self.hook("tok_aruneem"), [], "aruneem never sees alerts that were resolved before the next hook call")
        self.assertEqual(len(self.events("alert_resolved")), 2, "no duplicate row for the idempotent call")

        # check_conflicts skips resolved alerts too: nothing open names matthew now.
        self.assertEqual(self.mcp.resolved_alert_ids(self.mcp.get_db()), {8, 10})

    def test_3_accept_rewrites_shape(self):
        before = self.shape("GET /users/{id}")
        self.assertIn('"name"', before)

        r = self.client.post("/api/proposals/7", json={"status": "accepted"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"id": 7, "status": "accepted", "by": "human"})

        after = self.shape("GET /users/{id}")
        self.assertIn('"first_name"', after)
        self.assertNotIn('"name"', after)
        self.assertEqual(self.shape("GET /orders"), '{\n  "orders": "Order[]"\n}', "other contracts untouched")

        payload = json.loads(self.events("proposal_decision")[-1][3])
        self.assertEqual(payload, {"proposal_id": 7, "status": "accepted", "entry": "GET /users/{id}", "previous_shape": before, "shape": after})

        r = self.client.post("/api/proposals/7", json={"status": "rejected"})
        self.assertEqual(r.status_code, 409, "a proposal is decided once")
        self.assertEqual(self.shape("GET /users/{id}"), after)
        self.assertIsNone(self.mcp.pending_proposal_for("GET /users/{id}"), "decided proposals are no longer pending")

    def test_4_free_text_change_cannot_be_accepted(self):
        conn = sqlite3.connect(self.db)
        conn.execute(
            "INSERT INTO events (agent, type, payload) VALUES ('matthew', 'propose_spec_change', ?)",
            (json.dumps({"entry": "GET /orders", "change": "drop total", "reason": "test"}),),
        )
        conn.commit()
        pid = conn.execute("SELECT max(id) FROM events").fetchone()[0]
        conn.close()

        self.assertEqual(self.client.post(f"/api/proposals/{pid}", json={"status": "accepted"}).status_code, 422)
        self.assertEqual(self.shape("GET /orders"), '{\n  "orders": "Order[]"\n}')
        self.assertEqual(self.client.post(f"/api/proposals/{pid}", json={"status": "rejected"}).status_code, 200)


    def test_5_whoami_and_reset(self):
        self.assertEqual(self.client.get("/api/whoami").status_code, 401)
        self.assertEqual(self.client.get("/api/whoami", headers={"Authorization": "Bearer tok_matthew"}).json(), {"name": "matthew", "color": "#7a9a6e"})

        self.assertEqual(self.client.post("/api/reset").status_code, 401, "reset needs a teammate token")
        conn = sqlite3.connect(self.db)
        self.assertGreater(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0, "earlier cases left rows behind")
        conn.close()

        r = self.client.post("/api/reset", headers={"Authorization": "Bearer tok_aruneem"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["by"], "aruneem")
        self.assertEqual(r.json()["spec"], 2)

        conn = sqlite3.connect(self.db)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT agent, file FROM claims ORDER BY agent").fetchall(), [("aruneem", "backend/api/users.py"), ("matthew", "frontend/src/components/UserCard.tsx")])
        conn.close()
        self.assertIn('"email"', self.shape("GET /users/{id}"), "the accepted proposal from test_3 is rolled back to the seed shape")
        self.assertEqual(self.mcp._last_seen, {}, "debounce memory cleared")

    def test_6_failed_judgement_logs_review_failed(self):
        # A spec row whose JSON columns are corrupt makes judge_edit's conversion raise
        # before any model is touched. The failure must surface as a review_failed event
        # (CONTRACT.md's enum) rather than vanishing into the container log — and must
        # never raise out of judge_edit, whose caller is a fire-and-forget BackgroundTask.
        self.mcp.judge_edit(
            "-email",
            {"contract": "GET /users/{id}", "owner": "backend/api/users.py", "consumers": "not json", "shape": "{}"},
            "aruneem",
        )
        rows = self.events("review_failed")
        self.assertEqual(len(rows), 1)
        _, agent, _, payload = rows[0]
        payload = json.loads(payload)
        self.assertEqual(agent, "coordinator")
        self.assertEqual(payload["contract"], "GET /users/{id}")
        self.assertEqual(payload["edited_by"], "aruneem")
        self.assertIn("error", payload)
        self.assertIsInstance(payload["duration_ms"], int)


if __name__ == "__main__":
    unittest.main()
