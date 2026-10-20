#!/bin/bash
# Assemble le dossier web-dist/ (le site seul, sans tests ni moteur) pour la coque Tauri
set -e
cd "$(dirname "$0")"
rm -rf web-dist && mkdir web-dist
cp *.html *.js *.css web-dist/
cp -R assets vendor i18n web-dist/
[ -f manifest.json ] && cp manifest.json web-dist/ || true
echo "web-dist/ prêt : $(ls web-dist | wc -l) éléments"
