"""Offline provenance tests: no inference calls or production database writes."""

import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.alert_context import enrich_alert, review_context, reviewing
from backend import coordinator


SPEC = {"contract": "GET /inventory", "owner": "service/stock.py", "consumers": ["web/Stock.tsx"], "shape": {"quantity": "int"}}


class AlertContextTests(unittest.TestCase):
    def test_sql_row_and_scope_cleanup(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT ? AS contract, ? AS owner, ? AS consumers", (SPEC["contract"], SPEC["owner"], json.dumps(SPEC["consumers"]))).fetchone()
            with self.assertRaises(RuntimeError):
                with reviewing(row, 17):
                    self.assertEqual(enrich_alert({"edit_id": 999})["edit_id"], 17)
                    self.assertEqual(review_context(SPEC)["consumers"], SPEC["consumers"])
                    raise RuntimeError("review failed")
            self.assertEqual(enrich_alert({"summary": "legacy"}), {"summary": "legacy"})

    def test_tool_workers_keep_each_reviews_origin(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(coordinator, "DB_PATH", str(Path(directory) / "test.db")):
            with closing(sqlite3.connect(coordinator.DB_PATH)) as db:
                coordinator._ensure_schema(db)
            with reviewing(SPEC, 21):
                first = coordinator._review_tools(review_context(SPEC))
            other = {**SPEC, "contract": "GET /shipments", "owner": "services/shipping.py", "consumers": ["mobile/Tracking.tsx"]}
            with reviewing(other, 22):
                second = coordinator._review_tools(review_context(other))
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(first[0], "Quantity removed", ["builder"], "Restore quantity"), pool.submit(second[1], "Accept shipment shape?")]
                for future in futures:
                    future.result()
            with closing(sqlite3.connect(coordinator.DB_PATH)) as db:
                alerts = {p["edit_id"]: p for (raw,) in db.execute("SELECT payload FROM events WHERE type='alert'") for p in [json.loads(raw)]}
            self.assertEqual(alerts[21]["owner"], SPEC["owner"])
            self.assertEqual(alerts[22]["consumers"], other["consumers"])
            self.assertTrue(alerts[22]["escalated"])

    def test_structured_fallback_records_the_same_context(self):
        verdict = SimpleNamespace(drift=True, explanation="Quantity removed", affected=[], suggested_fix="Restore quantity")
        fake_agent = lambda **kwargs: lambda *args, **options: SimpleNamespace(structured_output=verdict)
        with tempfile.TemporaryDirectory() as directory, patch.object(coordinator, "DB_PATH", str(Path(directory) / "test.db")), patch.object(coordinator, "Agent", fake_agent), patch.object(coordinator, "_build_model", return_value=None):
            with reviewing(SPEC, 31):
                coordinator.run_coordinator("-quantity", SPEC, structured=True)
            with closing(sqlite3.connect(coordinator.DB_PATH)) as db:
                payload = json.loads(db.execute("SELECT payload FROM events WHERE type='alert'").fetchone()[0])
            self.assertEqual(payload["edit_id"], 31)
            self.assertEqual(payload["consumers"], SPEC["consumers"])


if __name__ == "__main__":
    unittest.main()
