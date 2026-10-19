#!/bin/sh
# Uji logika murni UI (validasi auth). Terpisah dari run-test.sh karena rootDir berbeda.
set -e
cd "$(dirname "$0")/.."
TSC=./node_modules/.bin/tsc
[ -x "$TSC" ] || TSC=tsc
rm -rf .tmp-ui
$TSC -p scripts/tsconfig.test-ui.json
node scripts/test-auth.js
