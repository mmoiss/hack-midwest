# Team Agent Coordinator — instructions for Codex

Before starting work on any file, call `declare_intent` with the files you're about to touch and a one-line summary. Before editing a file that owns or consumes a contract (see `spec/NOTES.md`), call `check_conflicts` first.
