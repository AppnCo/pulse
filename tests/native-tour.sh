#!/bin/bash
# Tour des plugins externes dans la vraie appli (aucun son joué, son du Mac coupé par sécurité). Journal : /tmp/pulse-native-tour.log
set +e
cd "$(dirname "$0")/.."
WAS_MUTED=$(osascript -e 'output muted of (get volume settings)' 2>/dev/null || echo false)
osascript -e 'set volume output muted true' 2>/dev/null || true
export PATH=$HOME/.cargo/bin:$HOME/Library/Python/3.9/bin:$PATH CARGO_TARGET_DIR=$HOME/pulse-build/tauri-target
./make-web.sh >/dev/null
cp tests/native/selftest-ext-tour.html web-dist/selftest-ext-tour.html
[ -n "$TOUR_EXIT" ] && sed -i '' 's/const SORTIE=false;/const SORTIE=true;/' web-dist/selftest-ext-tour.html
# TOUR_RE="SSL|Pro-Q" : ne tester que ces plugins (expression régulière)
[ -n "$TOUR_RE" ] && python3 - <<'P'
import os,re
p='web-dist/selftest-ext-tour.html'; s=open(p).read(); s=re.sub(r'const VEUT=/.*?/i;', 'const VEUT=/'+os.environ['TOUR_RE']+'/i;', s, count=1); open(p,'w').write(s)
P
cp src-tauri/tauri.conf.json /tmp/tauri.conf.keep
trap 'cp /tmp/tauri.conf.keep src-tauri/tauri.conf.json; ./make-web.sh >/dev/null; osascript -e "set volume output muted $WAS_MUTED" 2>/dev/null || true' EXIT
python3 - <<'P'
import json
p='src-tauri/tauri.conf.json'; j=json.load(open(p)); j['app']['windows'][0]['url']='selftest-ext-tour.html'; json.dump(j,open(p,'w'),indent=2)
P
(cd src-tauri && cargo build 2>&1 | grep -E "^error|Finished")
PULSE_TEST=1 "$CARGO_TARGET_DIR/debug/pulse-app" 2>/dev/null > /tmp/pulse-native-tour.log &
PID=$!
for i in $(seq 1 ${TOUR_MAX:-1000}); do grep -qE "FIN|SORTIE" /tmp/pulse-native-tour.log 2>/dev/null && break; kill -0 $PID 2>/dev/null || { echo "APPLI FERMÉE (plantage ?)" >> /tmp/pulse-native-tour.log; break; }; sleep 1; done
if [ -n "$TOUR_EXIT" ]; then for i in $(seq 1 20); do kill -0 $PID 2>/dev/null || break; sleep 1; done; if kill -0 $PID 2>/dev/null; then echo "SORTIE: appli encore là après 20 s" >> /tmp/pulse-native-tour.log; else wait $PID; echo "SORTIE: code $?" >> /tmp/pulse-native-tour.log; fi; fi
kill $PID 2>/dev/null || true
cat /tmp/pulse-native-tour.log
