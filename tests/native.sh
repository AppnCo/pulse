#!/bin/bash
# Test de l'appli de bureau : le studio joue par le moteur Rust, fenetre invisible. Affiche le journal du test.
set -e
cd "$(dirname "$0")/.."
# L'appli joue pour de vrai par la sortie du Mac : on coupe le son du Mac pendant le test (et on le remet comme avant après),
# sinon on entend des bips et des bouts de musique la nuit (vécu le 04/11)
WAS_MUTED=$(osascript -e 'output muted of (get volume settings)' 2>/dev/null || echo false)
# Certaines sorties (ex. « Pro Tools Aggregate I/O » de Ridwane) ne se coupent pas : le test ferait du bruit → il refuse de tourner
# sauf si on l'autorise exprès (PULSE_SON_OK=1, quand Ridwane est là et d'accord)
if [ "$WAS_MUTED" != "true" ] && [ "$WAS_MUTED" != "false" ] && [ "${PULSE_SON_OK:-0}" != "1" ]; then
  echo "SANS SON IMPOSSIBLE : la sortie audio du Mac ne se coupe pas ($WAS_MUTED). Test sauté (PULSE_SON_OK=1 pour le lancer quand même)."; exit 0
fi
osascript -e 'set volume output muted true' 2>/dev/null || true
trap 'osascript -e "set volume output muted $WAS_MUTED" 2>/dev/null || true' EXIT
export PATH=$HOME/.cargo/bin:$HOME/Library/Python/3.9/bin:$PATH CARGO_TARGET_DIR=$HOME/pulse-build/tauri-target
./make-web.sh >/dev/null
cp tests/native/selftest.html web-dist/selftest.html; cp tests/native/selftest-ext.html web-dist/selftest-ext.html
cp src-tauri/tauri.conf.json /tmp/tauri.conf.keep
# (un seul « trap EXIT » à la fois : celui-ci remplace le précédent, il doit donc aussi remettre le son — sinon le Mac restait muet)
trap 'cp /tmp/tauri.conf.keep src-tauri/tauri.conf.json; ./make-web.sh >/dev/null; osascript -e "set volume output muted $WAS_MUTED" 2>/dev/null || true' EXIT
python3 - <<'P'
import json
p='src-tauri/tauri.conf.json'; j=json.load(open(p)); j['app']['windows'][0]['url']=__import__('os').environ.get('SELFTEST','selftest.html'); json.dump(j,open(p,'w'),indent=2)
P
(cd src-tauri && cargo build 2>&1 | grep -E "^error|Finished")
PULSE_TEST=1 "$CARGO_TARGET_DIR/debug/pulse-app" 2>/tmp/pulse-native-test.err > /tmp/pulse-native-test.log &
PID=$!
for i in $(seq 1 160); do grep -q FIN /tmp/pulse-native-test.log 2>/dev/null && break; sleep 1; done
kill $PID 2>/dev/null || true
cat /tmp/pulse-native-test.log
grep -q "isNative=true pos=" /tmp/pulse-native-test.log && grep -q "relance: première=pulse puis=projet" /tmp/pulse-native-test.log && grep -q "mute en direct: relances=0 avance=0.[3-5]" /tmp/pulse-native-test.log && grep -q "relance: première=pulse puis=projet" /tmp/pulse-native-test.log && grep -q "monitor running=true" /tmp/pulse-native-test.log && grep -q "monitor après stop running=false" /tmp/pulse-native-test.log && grep -q "boucle native: relances=0 hors_boucle=0" /tmp/pulse-native-test.log && grep -q "looping=true trous=0" /tmp/pulse-native-test.log && grep -qE "vumetres natifs: piste=0\.[0-9]*[1-9][0-9]* master=[1-9]" /tmp/pulse-native-test.log && grep -qE "boucle changée: relances=0 rust_pos=1\.[2-7]" /tmp/pulse-native-test.log && grep -qE "afficheurs plugin: spectre_max=-[1-9][0-9]? gr=[0-9]" /tmp/pulse-native-test.log && grep -qE "plugin en direct: relances=0 joue=true trous=0 looping=true rust_pos=1\.[2-7]" /tmp/pulse-native-test.log && grep -qE "afficheurs natifs: gate=0\.[0-9]+/[0-9.]+ deess=0\.[0-9]+ mband=1 limit=[0-9.]+/[0-9.]+" /tmp/pulse-native-test.log && grep -qE "envoi en morceaux: joue=true via=pulse pos=1\.[0-9]" /tmp/pulse-native-test.log && grep -qE "eq en marche: reconstructions=0 accepte=true trous=0" /tmp/pulse-native-test.log && grep -qE "interrupteurs en marche: reconstructions=0 capacités=eq-swap\+switches trous=0" /tmp/pulse-native-test.log && grep -q FIN /tmp/pulse-native-test.log && echo "OK" || { echo "ECHEC"; exit 1; }
