# Kredit aset

## Model monster (public/models/gaunt-creature.glb)
"Gaunt Horror Creature - Free Creepy 3D Model" oleh **PurplePoint**
Sumber: https://sketchfab.com/3d-models/gaunt-horror-creature-free-creepy-3d-model-22a418d047764a23b73b539686b988c6
Lisensi: CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/) - atribusi ini wajib dipertahankan.
Perubahan: dipasangi tulang + skin weight + animasi (scripts/rig-monster.py), tekstur diperkecil, atribut tambahan dibuang.

## Teriakan monster (public/sfx/monster_scream.wav)
Dibuat sepenuhnya dengan sintesis kode (scripts/gen-monster-sfx.py) - tanpa sampel pihak ketiga.

## Audio tangkapan (TAHAP 4)
Memakai ulang `public/sfx/monster_scream.wav` (sintesis kode, lihat di atas) dan `public/sfx/impact-slam-46.mp3` (sudah ada di repo sejak SFX mp3; sumber/lisensi sama seperti sebelumnya). Tidak ada aset audio baru.

- public/textures/*.jpg: diturunkan dari rusty_metal_04 dan asphalt_02 (4K, diperkecil ke 512px; aspal hanya untuk lantai bunker). Sumber tekstur yang dikirim pengguna; cek lisensi aslinya sebelum rilis.

- Tekstur dinding (public/textures/walls): Poly Haven (CC0) — Dark Brick Wall, Wooden Panels, Worn Mossy Plasterwall, Cracked Concrete Wall, Dark Wooden Planks. Peta normal & roughness dibuat ulang dari displacement/diffuse (EXR DWAA tidak terbaca).
