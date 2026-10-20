#!/bin/bash
# Lance des scénarios de test sur Windows (Git Bash) : Chrome sans fenêtre + serveur node.
# Usage : bash tests/run-win.sh tests/scenarios/xxx.mjs [autres…]   (chemins relatifs à PULSE/)
DIR="$(cd "$(dirname "$0")/.." && pwd)"; DIRW="$(cygpath -m "$DIR" 2>/dev/null || echo "$DIR")"
export PULSE_HTTP_PORT="${PULSE_HTTP_PORT:-8765}" PULSE_CDP_PORT="${PULSE_CDP_PORT:-9333}"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
PROF="${TEMP:-/tmp}/pulse-chrome-$PULSE_CDP_PORT"
node "$DIRW/tests/serve.mjs" "$PULSE_HTTP_PORT" & SRV=$!
"$CHROME" --headless=new --disable-gpu --mute-audio --autoplay-policy=no-user-gesture-required --user-data-dir="$PROF" --remote-debugging-port=$PULSE_CDP_PORT --window-size=1440,860 about:blank >/dev/null 2>&1 &
for i in $(seq 1 30); do curl -s localhost:$PULSE_CDP_PORT/json/version >/dev/null && break; sleep 1; done; sleep 1
for s in "$@"; do echo "=== $s"; node "$DIRW/tests/cdp.mjs" "file:///$DIRW/$s"; done
kill $SRV 2>/dev/null
# Ne fermer QUE le Chrome des tests, jamais celui de l'utilisateur
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$DIRW/tests/stop-test-chrome.ps1" >/dev/null 2>&1
