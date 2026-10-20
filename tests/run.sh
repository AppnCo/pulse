#!/bin/bash
# Lance un scénario de test dans Chrome sans fenêtre.  Usage : tests/run.sh tests/<scenario>.mjs
# Les scénarios pilotent la vraie app (studio.html) avec un micro simulé.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
HP="${PULSE_HTTP_PORT:-8765}"; CP="${PULSE_CDP_PORT:-9333}"   # ports réglables : on peut lancer deux séries de tests en même temps
PROF="${TMPDIR:-/tmp}/pulse-test-chrome-$CP"; export PULSE_HTTP_PORT="$HP" PULSE_CDP_PORT="$CP"
lsof -ti:$HP | xargs kill 2>/dev/null; pkill -f "remote-debugging-port=$CP" 2>/dev/null
(cd "$DIR" && python3 -m http.server $HP >/dev/null 2>&1 &)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --mute-audio --autoplay-policy=no-user-gesture-required --user-data-dir="$PROF" --remote-debugging-port=$CP --window-size=1440,860 about:blank >/dev/null 2>&1 &
for i in $(seq 1 30); do curl -s localhost:$CP/json/version >/dev/null && break; sleep 1; done; sleep 1
for s in "$@"; do echo "=== $s"; node "$DIR/tests/cdp.mjs" "$(cd "$(dirname "$s")" && pwd)/$(basename "$s")"; done
pkill -f "remote-debugging-port=$CP" 2>/dev/null; lsof -ti:$HP | xargs kill 2>/dev/null; rm -rf "$PROF"
