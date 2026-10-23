#!/data/data/com.termux/files/usr/bin/bash
# Jalankan SEKALI. Memasang JDK 17, aapt2, Android SDK (platform 33 + build-tools 33.0.2) dan Gradle 8.9.
set -e
pkg update -y
pkg install -y openjdk-17 aapt2 unzip wget

export ANDROID_HOME="$HOME/android-sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"
if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
  cd "$ANDROID_HOME/cmdline-tools"
  wget -O cl.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q cl.zip && mv cmdline-tools latest && rm cl.zip
fi
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKM" --sdk_root="$ANDROID_HOME" --licenses > /dev/null || true
"$SDKM" --sdk_root="$ANDROID_HOME" "platforms;android-33" "build-tools;33.0.2"

mkdir -p "$HOME/tools" && cd "$HOME/tools"
if [ ! -d gradle-8.9 ]; then
  wget -O g.zip https://services.gradle.org/distributions/gradle-8.9-bin.zip
  unzip -q g.zip && rm g.zip
fi
echo "SETUP SELESAI"
