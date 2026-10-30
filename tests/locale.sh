#!/bin/bash
# Test de l'appli servie depuis l'ordinateur (pulse://) : page « sûre », transfert des projets, mise à jour automatique.
# Tout se passe dans des dossiers temporaires (PULSE_DATA_DIR) et le stockage du build de test : jamais les données de l'utilisateur.
set -e
cd "$(dirname "$0")/.."
export PATH=$HOME/.cargo/bin:$PATH CARGO_TARGET_DIR=$HOME/pulse-build/tauri-target
T=$(mktemp -d); D="$T/donnees"; SITE="$T/site"; L="$T/log"; mkdir -p "$D" "$SITE"
./make-web.sh >/dev/null
echo '<!doctype html><meta charset="utf-8"><title>vide</title>' > web-dist/blank.html
cp src-tauri/tauri.conf.json "$T/conf.keep"
trap 'cp "$T/conf.keep" src-tauri/tauri.conf.json; ./make-web.sh >/dev/null; pkill -f "http.server 8798" 2>/dev/null; rm -rf "$T"' EXIT
LOC=tests/native/locale
# lance la fenêtre de test sur $1 avec le script $2 (+ migrate.js en mode manuel si $3=mig)
run() {
  python3 - "$1" <<'P'
import json,sys
p='src-tauri/tauri.conf.json'; j=json.load(open(p)); j['app']['windows'][0]['url']=sys.argv[1]; json.dump(j,open(p,'w'),indent=2)
P
  (cd src-tauri && cargo build 2>&1 | grep -E "^error" -A5 || true)
  if [ "$3" = mig ]; then { echo "window.__PULSE_MIGRATE_MANUAL__=true;"; cat migrate.js; echo ";"; cat "$2"; } > "$T/js"; else cp "$2" "$T/js"; fi
  : > "$L"
  PULSE_TEST=1 PULSE_DATA_DIR="$D" PULSE_TEST_EVAL="$T/js" "$CARGO_TARGET_DIR/debug/pulse-app" 2>/dev/null > "$L" &
  local pid=$!
  for i in $(seq 1 90); do grep -q FIN "$L" 2>/dev/null && break; sleep 1; done
  kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true
  grep -v FIN "$L"; cat "$L" >> "$T/all.log"
}
OLD=https://appnco.app/pulse/zz-test-ipc-404
run pulse://localhost/blank.html $LOC/clean.js
run $OLD $LOC/clean.js
run pulse://localhost/blank.html $LOC/secure.js
run $OLD $LOC/seed-export.js mig
run pulse://localhost/blank.html $LOC/import-check.js mig
# faux site : copie de web-dist avec une page modifiée et sa liste d'empreintes
ditto web-dist "$SITE"; echo '<!-- version-de-test-locale -->' >> "$SITE/studio.html"
python3 - "$SITE" <<'P'
import hashlib, json, os, sys
root=sys.argv[1]; files={}
for dp,dn,fn in os.walk(root):
    for n in fn:
        if not n.startswith('.') and n!='web-manifest.json':
            rel=os.path.relpath(os.path.join(dp,n),root); files[rel]=hashlib.sha256(open(os.path.join(dp,n),'rb').read()).hexdigest()
json.dump({'version':'test','files':files},open(os.path.join(root,'web-manifest.json'),'w'))
P
(cd "$SITE" && python3 -m http.server 8798 >/dev/null 2>&1 &); sleep 1
export PULSE_WEB_BASE=http://localhost:8798/
run pulse://localhost/blank.html $LOC/update.js
python3 - "$SITE" <<'P'
import json,sys
p=sys.argv[1]+'/web-manifest.json'; m=json.load(open(p)); m['files']['audio.js']='0'*64; m['version']='abîmée'; json.dump(m,open(p,'w'))
P
run pulse://localhost/blank.html $LOC/update-bad.js
run pulse://localhost/blank.html $LOC/clean.js >/dev/null
A="$T/all.log"
grep -q "locale: canal_rapide=true secure=true micro=true worklet=ok" "$A" \
 && grep -qE "export: [0-9]+ ms" "$A" \
 && grep -q "transfert: fini=true sons_identiques=3/3 secours=true projets=1 projet_courant=Projet migré session_copiée=false etat=fait" "$A" \
 && grep -qE "maj: 1re=mis à jour \(1 fichier\) 2e=à jour servie_nouvelle=true" "$A" \
 && grep -q "maj abîmée: refusé ancienne_gardée=true" "$A" \
 && ! grep -q ERREUR "$A" && echo "OK" || { echo "ECHEC"; exit 1; }
