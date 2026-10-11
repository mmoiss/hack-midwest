#!/usr/bin/env python3
"""Shared PostToolUse hook for Claude Code and Codex.

Diffs demo-repo against the demo-seed tag (not HEAD -- so an agent's own git
commits mid-session don't blind us), POSTs one /events call per changed file,
and prints any returned alerts back into the calling agent's context.

Usage: report_edit.py --agent claude-code|codex
Env:   CLAUDE_TEAM_TOKEN, CODEX_TEAM_TOKEN, TEAM_EVENTS_URL, CODEX_OUTPUT_MODE
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_REF = "demo-seed"
DEFAULT_EVENTS_URL = "http://localhost:8787/events"


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True)
    return result.stdout


# Agent configuration and the demo tooling itself are not application code: demo.sh/demo.ps1
# rewrite .codex/config.toml to point at the server, and nobody wants that on the dashboard.
IGNORED_PREFIXES = (".codex/", ".claude/", ".mcp.json", ".env", "hooks/", "scripts/", "demo.sh", "demo.ps1")


def changed_files() -> list[str]:
    git("add", "-A")  # stage new/renamed files so they're visible to the diff below
    out = git("diff", "--name-only", "--no-renames", BASE_REF)
    return [line for line in out.splitlines() if line.strip() and not line.startswith(IGNORED_PREFIXES)]


def file_diff(path: str) -> str:
    return git("diff", "--no-renames", "--no-color", BASE_REF, "--", path)


def post_event(url: str, token: str, agent: str, path: str, diff_text: str) -> dict:
    body = json.dumps({"agent": agent, "file": path, "diff": diff_text}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return {"alerts": []}


def emit(agent: str, alerts: list[dict]) -> None:
    if not alerts:
        return
    text = "\n".join(
        f"[team-coordinator] {a.get('summary', '')} "
        f"(affects: {', '.join(a.get('affected', []))}). "
        f"Suggested fix: {a.get('suggested_fix', '')}"
        for a in alerts
    )
    codex_mode = os.environ.get("CODEX_OUTPUT_MODE", "json")  # flip to "plain" if additionalContext turns out unsupported
    use_json = agent == "claude-code" or (agent == "codex" and codex_mode == "json")
    if use_json:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}}))
    else:
        print(text)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", required=True, choices=["claude-code", "codex"])
    args = parser.parse_args()

    token_env = "CLAUDE_TEAM_TOKEN" if args.agent == "claude-code" else "CODEX_TEAM_TOKEN"
    token = os.environ.get(token_env, "")
    url = os.environ.get("TEAM_EVENTS_URL", DEFAULT_EVENTS_URL)

    alerts: list[dict] = []
    for path in changed_files():
        diff_text = file_diff(path)
        if not diff_text or diff_text.startswith("Binary files") or "GIT binary patch" in diff_text:
            continue
        result = post_event(url, token, args.agent, path, diff_text)
        alerts.extend(result.get("alerts", []))

    emit(args.agent, alerts)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)  # a hook crash must never block or visibly break the agent's turn
