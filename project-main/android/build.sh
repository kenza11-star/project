#!/data/data/com.termux/files/usr/bin/bash
# Build APK debug. Contoh ganti URL game: ./build.sh -PGAME_URL=https://domain-lain.com/
set -e
cd "$(dirname "$0")"
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME:-$PREFIX/lib/jvm/java-17-openjdk}"
echo "sdk.dir=$ANDROID_HOME" > local.properties

"$HOME/tools/gradle-8.9/bin/gradle" --no-daemon \
  -Pandroid.aapt2FromMavenOverride="$PREFIX/bin/aapt2" \
  "$@" assembleDebug

APK="app/build/outputs/apk/debug/app-debug.apk"
echo "APK: $(pwd)/$APK"
if [ -d "$HOME/storage/downloads" ]; then
  cp "$APK" "$HOME/storage/downloads/NightRound-debug.apk"
  echo "Disalin ke: ~/storage/downloads/NightRound-debug.apk (folder Download HP)"
fi
