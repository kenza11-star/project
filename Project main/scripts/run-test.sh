#!/bin/sh
# Kompilasi modul logika murni lalu jalankan uji dengan GLB asli.
set -e
cd "$(dirname "$0")/.."
TSC=./node_modules/.bin/tsc
[ -x "$TSC" ] || TSC=tsc
rm -rf .tmp-game
$TSC -p scripts/tsconfig.test.json
node scripts/test-game.js
node scripts/test-puzzleroom.js
node scripts/test-polish.js
node scripts/test-hide.js
node scripts/test-chair.js
node scripts/test-opening.js
node scripts/test-lightfx.js
node scripts/test-sfx.js
node scripts/test-soda.js
node scripts/test-scare.js
node scripts/test-players.js
node scripts/test-pause.js
sh scripts/run-test-ui.sh
tsc_net() { $TSC -p scripts/tsconfig.test-net.json; }
tsc_net && node scripts/test-net.js
sh scripts/run-test-backend.sh
$TSC -p scripts/tsconfig.test-lockers.json && node scripts/test-lockers.js && node blitz-relay/test.js
node scripts/test-monster.js
$TSC -p scripts/tsconfig.test-lockers.json && node scripts/test-drag.js
node scripts/test-capture.js
node scripts/test-capture-audio.js
node scripts/test-monster-2f.js
node scripts/test-monster-glb.js
node scripts/test-monster-door.js
node scripts/test-switch.js
node scripts/test-notes.js
