"""The Strands agent that judges contract drift.

Given one edit to a file that owns a contract, decide whether the edit still
satisfies the agreed shape for that contract's consumers. Context (diff, spec
entry, consumers) is assembled by the caller and handed over in a single
prompt -- this module never calls a tool to go fetch more of it. See
SPEC.md's "Coordinator" section and CONTRACT.md for the shapes this plugs
into.

Invocation contract (proposed, confirm with Track A before relying on it):
    run_coordinator(diff: str, spec_entry: dict, consumers: list[str]) -> None
"""

import json
import os
import sqlite3

from pydantic import BaseModel
from strands import Agent, tool
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent
from strands.models.openai import OpenAIModel

DB_PATH = os.environ.get("COORDINATOR_DB_PATH", "coordinator.db")

SYSTEM_PROMPT = """You review one code edit against one API contract a team has agreed on.
You get the diff, the contract's agreed shape, and the files that consume it.
Decide only this: does the diff still satisfy the shape for every consumer listed?

If it does, say so in one short sentence and call no tool.
If it breaks the shape for a consumer, call raise_alert with a one-sentence
summary, the affected consumer file(s), and a concrete suggested fix.
If the situation needs a human decision instead of a clear verdict (for
example, the edit looks like a deliberate contract change), call
escalate_to_human with the question.
Call at most one tool per edit."""


class Verdict(BaseModel):
    """Structured fallback shape, used if hackathon-chat's tool calling proves flaky.

    Same two outcomes as the tool-calling path, so the server picks the
    result the same way either way.
    """

    drift: bool
    affected: list[str] = []
    explanation: str
    suggested_fix: str | None = None


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (datetime('now')),
            agent TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL
        )"""
    )


def _log_event(agent_name: str, event_type: str, payload: dict) -> None:
    conn = sqlite3.connect(DB_PATH)
    _ensure_schema(conn)
    conn.execute(
        "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
        (agent_name, event_type, json.dumps(payload)),
    )
    conn.commit()
    conn.close()


@tool
def raise_alert(summary: str, affected: list[str], suggested_fix: str) -> str:
    """Flag that this edit broke the contract for one or more consumers.

    Args:
        summary: Plain-language, one-sentence explanation of what broke.
        affected: The consumer file(s) that need to react.
        suggested_fix: A concrete suggestion for how to adapt.
    """
    _log_event(
        "coordinator",
        "alert",
        {"summary": summary, "affected": affected, "suggested_fix": suggested_fix},
    )
    return "Alert raised and logged."


@tool
def escalate_to_human(question: str) -> str:
    """Ask a human to decide something this review can't resolve on its own.

    Args:
        question: The decision a human needs to make.
    """
    _log_event("coordinator", "alert", {"question": question, "escalated": True})
    return "Escalated to a human."


def _build_model():
    """Pick the model provider from COORDINATOR_MODEL_PROVIDER.

    Swapping providers is changing this one function -- same Agent, same
    tools, same hooks -- which is the actual answer to SPEC.md's risk
    mitigation ("if Akamai's tool calling is flaky, switch to Bedrock").
    """
    provider = os.environ.get("COORDINATOR_MODEL_PROVIDER", "akamai")

    if provider == "akamai":
        return OpenAIModel(
            client_args={
                "api_key": os.environ["AKAMAI_TEAM_KEY"],
                "base_url": os.environ.get("AKAMAI_BASE_URL", "https://ws.akamai-workshops.com/v1"),
            },
            model_id="hackathon-chat",
            params={"max_tokens": 300},
        )

    if provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        return AnthropicModel(
            client_args={"api_key": os.environ["ANTHROPIC_API_KEY"]},
            model_id=os.environ.get("ANTHROPIC_MODEL_ID", "claude-haiku-4-5-20251001"),
            params={"max_tokens": 300},
        )

    if provider == "openai":
        return OpenAIModel(
            client_args={"api_key": os.environ["OPENAI_API_KEY"]},
            model_id=os.environ.get("OPENAI_MODEL_ID", "gpt-4o-mini"),
            params={"max_tokens": 300},
        )

    if provider == "ollama":
        from strands.models.ollama import OllamaModel

        return OllamaModel(
            host=os.environ.get("OLLAMA_HOST", "http://localhost:11434"),
            model_id=os.environ.get("OLLAMA_MODEL_ID", "llama3.1"),
        )

    raise ValueError(f"Unknown COORDINATOR_MODEL_PROVIDER: {provider!r}")


def _build_prompt(diff: str, spec_entry: dict, consumers: list[str]) -> str:
    return (
        f"Contract: {spec_entry['contract']}\n"
        f"Owner file: {spec_entry['owner']}\n"
        f"Agreed shape: {json.dumps(spec_entry['shape'])}\n"
        f"Consumers: {consumers}\n\n"
        f"Diff:\n{diff}\n"
    )


def _trace(event: BeforeToolCallEvent | AfterToolCallEvent, called: list[str]) -> None:
    """Print every tool call as it happens -- proves the Strands hook wiring works.

    Deliberately prints rather than writing to the events table: persisting
    this would mean two new event `type` values ("tool_call_started" /
    "tool_call_finished") that aren't in CONTRACT.md's frozen enum. If the
    dashboard's trace panel wants this level of granularity, that's a
    one-line addition here plus a CONTRACT.md amendment -- a sync with
    whoever owns the dashboard, not something to decide unilaterally.
    """
    if isinstance(event, BeforeToolCallEvent):
        print(f"[coordinator] -> {event.tool_use['name']}({event.tool_use['input']})")
    else:
        called.append(event.tool_use["name"])
        print(f"[coordinator] <- {event.tool_use['name']} finished ({event.result['status']})")


def run_coordinator(diff: str, spec_entry: dict, consumers: list[str], *, structured: bool = False) -> None:
    """Judge one edit. Call this once per debounced burst of saves to a contract-owning file.

    structured=True uses the Pydantic structured-output fallback instead of
    tool calling -- same two outcomes, same events written, for when
    hackathon-chat's tool calling turns out unreliable.
    """
    prompt = _build_prompt(diff, spec_entry, consumers)

    if structured:
        agent = Agent(model=_build_model(), system_prompt=SYSTEM_PROMPT)
        result = agent(prompt, structured_output_model=Verdict)
        verdict = result.structured_output
        if verdict.drift:
            _log_event(
                "coordinator",
                "alert",
                {
                    "summary": verdict.explanation,
                    "affected": verdict.affected,
                    "suggested_fix": verdict.suggested_fix,
                },
            )
        else:
            _log_event("coordinator", "checked_clean", {"contract": spec_entry["contract"]})
        return

    called: list[str] = []
    agent = Agent(model=_build_model(), tools=[raise_alert, escalate_to_human], system_prompt=SYSTEM_PROMPT)
    agent.add_hook(lambda event: _trace(event, called), [BeforeToolCallEvent, AfterToolCallEvent])
    agent(prompt)

    if not called:
        _log_event("coordinator", "checked_clean", {"contract": spec_entry["contract"]})
