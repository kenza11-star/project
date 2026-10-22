NIGHTROUND - PAKET LENGKAP
==========================

game/      Source game (Next.js) yang SUDAH dipatch (anti stuck loading + tombol "Coba lagi").
           Deploy folder ini ke Vercel (push ke repo GitHub kamu seperti biasa).
android/   Project APK (WebView wrapper). Dibuild di Termux.
game-loader-fix.patch   Hanya catatan perubahan di game/ (tidak perlu dipakai lagi).

LANGKAH
1. Salin isi folder game/ ke repo game kamu (timpa file lama), commit, push -> Vercel deploy.
   File yang berubah: lib/game/world.ts, components/lobby/PlayScene.tsx, components/lobby/Lobby.tsx
2. Build APK di Termux:
     cd android
     bash setup-termux.sh     (sekali saja)
     bash build.sh
3. APK: android/app/build/outputs/apk/debug/app-debug.apk
   (juga disalin ke folder Download HP sebagai NightRound-debug.apk)

Ganti URL game: edit GAME_URL di android/gradle.properties
