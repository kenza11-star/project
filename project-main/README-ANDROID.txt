NIGHTROUND - GAME + ANDROID APK
================================
project-main/            <- game Next.js (sudah dipatch anti stuck loading + tombol "Coba lagi")
project-main/android/    <- project APK WebView (build di Termux)

1. Push project-main ke GitHub -> Vercel deploy (folder android/ tidak mempengaruhi build web).
   File game yang berubah: lib/game/world.ts, components/lobby/PlayScene.tsx, components/lobby/Lobby.tsx

2. Build APK di Termux:
     cd project-main/android
     bash setup-termux.sh     (sekali saja)
     bash build.sh

3. APK: project-main/android/app/build/outputs/apk/debug/app-debug.apk
   (juga disalin ke folder Download HP: NightRound-debug.apk)

Ganti URL game: edit GAME_URL di android/gradle.properties
