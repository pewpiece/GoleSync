#!/usr/bin/env bash
# Runs every suite and prints real output. `scripts/run-all-tests.sh | tee TEST_OUTPUT.txt`
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0
run() { echo; echo "\$ $*"; "$@"; rc=$?; echo "[exit code $rc]"; [ $rc -eq 0 ] || status=1; }

echo "GoleSync test run: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "python: $(python3 --version 2>&1) | node: $(node --version) | npm: $(npm --version)"
echo "X11 tooling: Xvfb=$(command -v Xvfb || echo missing) xdotool=$(command -v xdotool || echo missing) xclip=$(command -v xclip || echo missing)"

echo; echo "################ AGENT ################"
cd "$ROOT/agent"
PY=.venv/bin/python; [ -x "$PY" ] || PY=python3
run "$PY" -m ruff check src tests
run "$PY" -m pytest -v --durations=5 -p no:cacheprovider

echo; echo "################ APP ################"
cd "$ROOT/app"
run npm run lint --silent
run npm run typecheck --silent
run npx jest --ci --verbose

echo; echo "################ SUMMARY ################"
[ $status -eq 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED"
exit $status
