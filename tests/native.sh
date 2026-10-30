#!/bin/bash
# Test de l'appli de bureau : le studio joue par le moteur Rust, fenetre invisible. Affiche le journal du test.
set -e
cd "$(dirname "$0")/.."
export PATH=$HOME/.cargo/bin:$PATH CARGO_TARGET_DIR=$HOME/pulse-build/tauri-target
./make-web.sh >/dev/null
cp tests/native/selftest.html web-dist/selftest.html
cp src-tauri/tauri.conf.json /tmp/tauri.conf.keep
trap 'cp /tmp/tauri.conf.keep src-tauri/tauri.conf.json; ./make-web.sh >/dev/null' EXIT
python3 - <<'P'
import json
p='src-tauri/tauri.conf.json'; j=json.load(open(p)); j['app']['windows'][0]['url']='selftest.html'; json.dump(j,open(p,'w'),indent=2)
P
(cd src-tauri && cargo build 2>&1 | grep -E "^error|Finished")
PULSE_TEST=1 "$CARGO_TARGET_DIR/debug/pulse-app" 2>/dev/null > /tmp/pulse-native-test.log &
PID=$!
for i in $(seq 1 70); do grep -q FIN /tmp/pulse-native-test.log 2>/dev/null && break; sleep 1; done
kill $PID 2>/dev/null || true
cat /tmp/pulse-native-test.log
grep -q "isNative=true pos=" /tmp/pulse-native-test.log && grep -q "relance: première=pulse puis=projet" /tmp/pulse-native-test.log && grep -q "mute en direct: relances=0 avance=0.[3-5]" /tmp/pulse-native-test.log && grep -q "relance: première=pulse puis=projet" /tmp/pulse-native-test.log && grep -q "monitor running=true" /tmp/pulse-native-test.log && grep -q "monitor après stop running=false" /tmp/pulse-native-test.log && grep -q "boucle native: relances=0 hors_boucle=0" /tmp/pulse-native-test.log && grep -q "looping=true trous=0" /tmp/pulse-native-test.log && grep -qE "vumetres natifs: piste=0\.[0-9]*[1-9][0-9]* master=[1-9]" /tmp/pulse-native-test.log && grep -qE "boucle changée: relances=0 rust_pos=1\.[2-7]" /tmp/pulse-native-test.log && grep -qE "afficheurs plugin: spectre_max=-[1-9][0-9]? gr=[0-9]" /tmp/pulse-native-test.log && grep -qE "plugin en direct: relances=0 joue=true trous=0 looping=true rust_pos=1\.[2-7]" /tmp/pulse-native-test.log && grep -qE "envoi en morceaux: joue=true via=pulse pos=1\.[0-9]" /tmp/pulse-native-test.log && grep -q FIN /tmp/pulse-native-test.log && echo "OK" || { echo "ECHEC"; exit 1; }
