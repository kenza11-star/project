# Voice chat (WebRTC mesh 2-6 pemain)

File: `lib/net/voice.ts` (VoiceMesh), `lib/net/voicemsg.ts` (bentuk pesan), dipakai `components/lobby/PlayScene.tsx`. Sinyal lewat `RoomClient.sendRtc/onRtc` (Realtime).

- **Peran tetap**: id lebih kecil = penawar (offer), id lebih besar = penjawab. Penjawab yang belum punya koneksi mengirim `h` (hello) agar penawar menawar.
- **`g` (sesi koneksi)** ada di semua offer/answer/ICE; pesan dengan `g` asing dibuang. `s` (sesi halaman) menandai refresh.
- **Transceiver selalu sendrecv**; mic hanya `replaceTrack`. OFF = tanpa track, MUTED = `track.enabled=false`, DENIED = hanya mendengar.
- **Sinyal**: antrean keluar (ditahan bila Realtime belum siap, maks 10 pesan/dtk), kandidat ICE ikut SDP + sisanya dikirim berkelompok; kandidat yang mendahului offer disimpan 10 dtk.
- **Pemeliharaan** tiap 2 dtk: bangun ulang koneksi gagal/macet (backoff 3-30 dtk), ICE restart saat `disconnected`, bersihkan peer yang keluar (masa tunggu 6 dtk).
- **Output**: satu `<audio>` per peer (di DOM, tak terlihat); diputar ulang otomatis pada gesture pertama. Tidak memakai AudioContext.
- Tidak ada rekaman/penyimpanan suara; tidak ada error teknis ke layar (hanya toast "Koneksi voice gagal" dibatasi 1x/20 dtk).
- **Produksi**: atur TURN sendiri (`NEXT_PUBLIC_TURN_URL/USER/CRED`); TURN publik bawaan hanya cadangan.

Uji: `npm run test:voice` (WebRTC tiruan + jam virtual: simulasi logika, bukan audio nyata di browser).
