#!/usr/bin/env bash
# Kept for muscle memory. The reset now lives in ../demo.sh (it resets this clone AND the
# server through POST /api/reset with your token, so no local database or SSH is involved).
exec "$(cd "$(dirname "$0")/.." && pwd)/demo.sh" reset "$@"
