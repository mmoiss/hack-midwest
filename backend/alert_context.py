"""Attach deterministic review provenance to events without asking the model for it."""

import json
from contextlib import contextmanager
from contextvars import ContextVar


_review = ContextVar("review_context", default=None)


def review_context(spec_entry, edit_id=None):
    consumers = spec_entry["consumers"]
    if isinstance(consumers, str):
        consumers = json.loads(consumers)
    active = _review.get() or {}
    return {
        "contract": spec_entry["contract"],
        "owner": spec_entry["owner"],
        "consumers": list(consumers),
        "edit_id": edit_id if edit_id is not None else active.get("edit_id"),
    }


@contextmanager
def reviewing(spec_entry, edit_id):
    token = _review.set(review_context(spec_entry, edit_id))
    try:
        yield
    finally:
        _review.reset(token)


def enrich_alert(payload, context=None):
    # Context wins over model-generated fields. Never infer an edit from "latest row".
    return {**payload, **(context if context is not None else _review.get() or {})}
