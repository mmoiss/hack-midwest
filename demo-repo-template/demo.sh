#!/usr/bin/env bash
# One command per demo step, for Git Bash (Windows) or any bash (macOS/Linux):
#
#   ./demo.sh up              launch your agent (Claude Code or Codex) connected to the server
#   ./demo.sh up "<prompt>"   same, headless: run one prompt and exit (for rehearsals)
#   ./demo.sh reset           put this clone AND the server back at the demo's starting state
#   ./demo.sh status          who the server thinks you are, server health, is this clone clean
#
# Everything comes from .env next to this script (copy .env.example): your token and the
# server URLs. Nothing else to export, no config file to edit. PowerShell users: demo.ps1.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

die() { echo "demo: $*" >&2; exit 1; }

# --- load .env (KEY=value lines; quotes optional; # comments ignored) ---
[ -f .env ] || die "no .env here. Copy .env.example to .env and paste your token into it."
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
  [ -z "$line" ] && continue
  key="${line%%=*}"; val="${line#*=}"
  val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"
  export "$key=$val"
done < .env

: "${TEAM_MCP_URL:?TEAM_MCP_URL missing from .env}"
: "${TEAM_EVENTS_URL:?TEAM_EVENTS_URL missing from .env}"
BASE="${TEAM_EVENTS_URL%/events}"
TOKEN="${CLAUDE_TEAM_TOKEN:-${CODEX_TEAM_TOKEN:-}}"
[ -n "$TOKEN" ] || die "no CLAUDE_TEAM_TOKEN or CODEX_TEAM_TOKEN in .env"

api() { # method path -> body (prints HTTP code on failure)
  curl -sS -X "$1" "$BASE$2" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --max-time 15 -w "\n%{http_code}"
}
whoami_name() {
  local out; out="$(api GET /api/whoami)" || return 1
  [ "${out##*$'\n'}" = "200" ] || return 1
  printf '%s' "${out%$'\n'*}" | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p'
}

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    # Which CLI: whichever token is set; both set -> `up claude` / `up codex` chooses.
    agent=""
    [ -n "${CLAUDE_TEAM_TOKEN:-}" ] && agent=claude
    [ -n "${CODEX_TEAM_TOKEN:-}" ] && agent="${agent:-codex}"
    case "${1:-}" in claude|codex) agent="$1"; shift;; esac
    [ "$agent" = codex ] && [ -z "${CODEX_TEAM_TOKEN:-}" ] && die "CODEX_TEAM_TOKEN not in .env"
    [ "$agent" = claude ] && [ -z "${CLAUDE_TEAM_TOKEN:-}" ] && die "CLAUDE_TEAM_TOKEN not in .env"
    [ "$agent" = codex ] && TOKEN="$CODEX_TEAM_TOKEN"
    name="$(whoami_name || true)"
    [ -n "$name" ] || die "the server at $BASE rejected this token (or is unreachable). Check .env, then: ./demo.sh status"
    if [ "$agent" = codex ]; then
      # Codex's MCP url is a literal in .codex/config.toml; point it at the server for this clone.
      # hooks/report_edit.py ignores .codex/ so this edit never shows up as an "edit" event.
      sed -i.bak "s#^url = .*#url = \"$TEAM_MCP_URL\"#" .codex/config.toml && rm -f .codex/config.toml.bak
    fi
    echo "demo: $agent as '$name' -> $BASE"
    if [ $# -gt 0 ]; then # headless, one prompt
      if [ "$agent" = claude ]; then
        exec claude -p "$*" --output-format text \
          --allowedTools "Read,Edit,Write,Glob,Grep,mcp__team-coordinator__declare_intent,mcp__team-coordinator__check_conflicts,mcp__team-coordinator__get_spec,mcp__team-coordinator__propose_spec_change"
      else
        # stdin closed: `codex exec` otherwise waits to "read additional input from stdin"
        # whenever stdin is not a terminal (CI, a script, another tool) and never starts.
        exec codex exec "$*" --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox < /dev/null
      fi
    fi
    exec "$agent"
    ;;
  reset)
    git reset -q --hard demo-seed && git clean -fdq && echo "demo: clone reset to demo-seed"
    out="$(api POST /api/reset)"; code="${out##*$'\n'}"; body="${out%$'\n'*}"
    [ "$code" = 200 ] || die "server reset failed (HTTP $code): $body"
    echo "demo: server reset by $(printf '%s' "$body" | sed -n 's/.*"by": *"\([^"]*\)".*/\1/p'): contracts restored, events cleared, aruneem/matthew claims in place"
    ;;
  status)
    name="$(whoami_name || true)"
    echo "server:   $BASE"
    echo "you are:  ${name:-UNKNOWN (token rejected or server unreachable)}"
    echo "health:   $(curl -sS --max-time 10 "$BASE/health" || echo unreachable)"
    dirty="$(git status --porcelain -- . ":!.codex/config.toml" | wc -l | tr -d ' ')"  # the launcher rewrites config.toml; not a demo edit
    echo "clone:    $([ "$dirty" = 0 ] && echo clean || echo "$dirty changed file(s) since demo-seed -- ./demo.sh reset to clear")"
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1
    ;;
esac
