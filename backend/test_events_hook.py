"""/events must answer before the coordinator judges, or alerts get lost.

    python -m backend.test_events_hook          # from the repo root

Runs a real uvicorn server on a free port (a Starlette TestClient waits for background
tasks, so it cannot see the timing this test is about) with judge_edit replaced by a slow
stand-in, and talks to it with the same 5-second urlopen timeout hooks/report_edit.py uses.
"""

import importlib
import json
import os
import runpy
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent.parent
TOKENS = {"tok_alice": {"name": "alice", "color": "#c8794a"}, "tok_bob": {"name": "bob", "color": "#7a9a6e"}}
HOOK_TIMEOUT = 5  # hooks/report_edit.py: urlopen(req, timeout=5)
JUDGE_SECONDS = 3  # stand-in for a 15-30 s model round trip


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class EventsAnswersBeforeJudging(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.db = os.path.join(cls.tmp.name, "coordinator.db")
        os.environ["DB_PATH"] = cls.db
        os.environ["COORDINATOR_DB_PATH"] = cls.db
        os.environ["TEAM_TOKENS"] = json.dumps(TOKENS)
        runpy.run_path(str(ROOT / "backend" / "seed.py"), run_name="__main__")  # spec + bob's claim on UserCard.tsx
        conn = sqlite3.connect(cls.db)
        conn.execute("DELETE FROM events")  # the seeded alerts would otherwise be "pending" for bob
        conn.commit()
        conn.close()

        sys.path.insert(0, str(ROOT))
        import backend.mcp as mcp

        cls.mcp = importlib.reload(mcp)
        cls.mcp.init_db()

        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(cls.mcp.mcp.http_app(), host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 10
        while not cls.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("uvicorn did not start")
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(5)
        cls.tmp.cleanup()

    def post(self, token: str, file: str) -> tuple[float, list[dict]]:
        """One hook call, timed, with the hook script's own timeout."""
        body = json.dumps({"agent": "test", "file": file, "diff": "-email"}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/events", data=body, method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        t0 = time.monotonic()
        with urllib.request.urlopen(req, timeout=HOOK_TIMEOUT) as resp:
            alerts = json.loads(resp.read().decode())["alerts"]
        return time.monotonic() - t0, alerts

    def test_hook_gets_its_response_and_the_alert_is_not_lost(self):
        judged = threading.Event()

        def slow_judge(diff, spec_entry, agent):
            time.sleep(JUDGE_SECONDS)
            self.mcp.log_event("coordinator", "alert", {"summary": "email dropped", "affected": ["bob"], "suggested_fix": "restore it"})
            judged.set()

        self.mcp.judge_edit = slow_judge  # handle_events looks the name up at call time

        # alice edits a contract-owning file: her hook must get an answer right away, not
        # after the (previously inline) judgement.
        elapsed, alerts = self.post("tok_alice", "backend/api/users.py")
        self.assertLess(elapsed, 1.0, "the response waited for the judgement")
        self.assertEqual(alerts, [])
        self.assertFalse(judged.is_set(), "judgement must run after the response, not before")

        # bob's hook fires while the judgement is still running: the event loop is not
        # blocked, so he gets an answer too (empty: the alert does not exist yet).
        elapsed, alerts = self.post("tok_bob", "frontend/src/components/UserCard.tsx")
        self.assertLess(elapsed, 1.0, "another agent's hook stalled behind the judgement")
        self.assertEqual(alerts, [])

        # Once the verdict lands, bob's next call carries it -- exactly once.
        self.assertTrue(judged.wait(JUDGE_SECONDS + 5), "judgement never finished")
        _, alerts = self.post("tok_bob", "frontend/src/components/UserCard.tsx")
        self.assertEqual([a["summary"] for a in alerts], ["email dropped"])
        _, alerts = self.post("tok_bob", "frontend/src/components/UserCard.tsx")
        self.assertEqual(alerts, [], "delivered alerts are not repeated")

    def test_non_owner_files_never_schedule_a_judgement(self):
        calls: list = []
        self.mcp.judge_edit = lambda *args: calls.append(args)
        self.post("tok_alice", "README.md")
        time.sleep(0.3)  # a background task would have run by now
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
