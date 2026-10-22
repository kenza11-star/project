#!/bin/sh
# Uji aturan backend murni (identitas, aturan room, kunci karakter) + pemeriksaan rahasia.
set -e
cd "$(dirname "$0")/.."
TSC=./node_modules/.bin/tsc
[ -x "$TSC" ] || TSC=tsc
rm -rf .tmp-backend
$TSC -p scripts/tsconfig.test-backend.json
node scripts/test-backend.js
node scripts/check-secrets.js
