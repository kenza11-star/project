#!/bin/sh
# Kompilasi modul logika murni lalu jalankan uji dengan GLB asli.
set -e
cd "$(dirname "$0")/.."
TSC=./node_modules/.bin/tsc
[ -x "$TSC" ] || TSC=tsc
rm -rf .tmp-game
$TSC -p scripts/tsconfig.test.json
node scripts/test-game.js
