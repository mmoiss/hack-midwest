"""Generate the TEAM_TOKENS line for .env.

    python scripts/make_tokens.py alice bob carol

The .env line goes to stdout so it can be piped or appended; the per-person tokens go to
stderr so they are easy to copy out and hand to each teammate individually.
"""

import json
import secrets
import sys

# Distinct enough to tell apart at a glance on the dashboard.
COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd"]


def main(names: list[str]) -> int:
    if not names:
        print(__doc__, file=sys.stderr)
        return 1
    if len(names) > len(COLORS):
        print(f"At most {len(COLORS)} teammates — one color each.", file=sys.stderr)
        return 1

    table = {
        f"tok_{secrets.token_urlsafe(24)}": {"name": name, "color": COLORS[i]}
        for i, name in enumerate(names)
    }

    # Compact, and single-quoted: the hex colors contain '#', which an env parser would
    # otherwise treat as the start of a comment.
    compact = json.dumps(table, separators=(",", ":"))
    print(f"TEAM_TOKENS='{compact}'")

    print("\nSend each teammate only their own token:", file=sys.stderr)
    for token, who in table.items():
        print(f"  {who['name']:<12} {token}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
