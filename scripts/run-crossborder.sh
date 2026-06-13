#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_HOME="$ROOT/.hermes"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

python -m hermes_cli.main "$@"
