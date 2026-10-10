"""Smoke test the Akamai inference connection in total isolation.

No Strands, no SQLite, no demo repo -- just a plain OpenAI-compatible call,
so a failure here can never be blamed on the agent harness. Confirms three
things independently: auth works, plain chat completions work, and tool
calling works (the one SPEC.md flagged as unproven for this model).

Usage: python backend/smoke_test_akamai.py
Env:   AKAMAI_TEAM_KEY, AKAMAI_BASE_URL, AKAMAI_CHAT_MODEL (or a local .env)
"""

import json
import os
import time

import truststore

truststore.inject_into_ssl()  # trust the OS certificate store (needed behind a TLS-inspecting proxy)

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

BASE_URL = os.environ.get("AKAMAI_BASE_URL", "https://ws.akamai-workshops.com/v1")
MODEL = os.environ.get("AKAMAI_CHAT_MODEL", "hackathon-chat")

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "raise_alert",
            "description": "Flag that a contract broke.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "affected": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["summary", "affected"],
            },
        },
    }
]


def main() -> None:
    client = OpenAI(api_key=os.environ["AKAMAI_TEAM_KEY"], base_url=BASE_URL)

    print(f"Base URL: {BASE_URL}")
    print(f"Model:    {MODEL}\n")

    print("-- plain completion --")
    t0 = time.time()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Reply with exactly one word: pong"}],
        max_tokens=10,
    )
    print(f"({time.time() - t0:.2f}s) {resp.choices[0].message.content!r}\n")

    print("-- tool calling --")
    t0 = time.time()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": (
                    "A function removed a field a teammate named bob depends on. "
                    "Call raise_alert about it."
                ),
            }
        ],
        tools=TOOLS,
        max_tokens=300,
    )
    elapsed = time.time() - t0
    message = resp.choices[0].message
    if message.tool_calls:
        call = message.tool_calls[0]
        print(f"({elapsed:.2f}s) tool call: {call.function.name}({call.function.arguments})")
        print("TOOL CALLING WORKS on this model.")
    else:
        print(f"({elapsed:.2f}s) no tool call, got text instead: {message.content!r}")
        print("TOOL CALLING DID NOT FIRE -- use COORDINATOR_MODEL_PROVIDER's structured-output fallback instead.")

    print("\n-- raw usage --")
    print(json.dumps(resp.usage.model_dump() if resp.usage else {}, indent=2))


if __name__ == "__main__":
    main()
