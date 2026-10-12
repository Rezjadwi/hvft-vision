# HVFT VISION — macOS (Electron)

Aplikasi seni kamera real-time: subjek (orang) diubah jadi point-cloud, mesh
triangulasi, glitch/HUD gaya poster teknis HVFT. Bisa keluar fullscreen ke
monitor/proyektor kedua untuk video mapping.

## 0. Pasang Node.js dulu (sekali saja)

Cek: `node -v && npm -v`. Kalau "command not found", pilih salah satu:

```bash
# A. lewat conda (paling cepat, tanpa admin — kamu sudah pakai conda base)
conda install -y -c conda-forge nodejs

# B. lewat Homebrew (kalau brew sudah ada)
brew install node
```

Kalau dua-duanya tidak ada, unduh installer resmi macOS (Apple Silicon .pkg)
dari https://nodejs.org (versi LTS), lalu buka Terminal baru.

## 1. Jalankan (di Terminal Mac, bukan cloud)

PENTING: jangan tulis `cd "~/Documents/..."` — di zsh tanda `~` di dalam kutip
TIDAK diterjemahkan jadi home folder. Pakai salah satu bentuk ini:

```bash
cd ~/"Documents/HVFT_PROJECTS/HVFT VISION MAC SOFTWARE"
# atau
cd "/Users/$USER/Documents/HVFT_PROJECTS/HVFT VISION MAC SOFTWARE"

npm install
npm start
```

Bangun DMG:

```bash
npm run dist     # hasil di ./dist
```

## Struktur

| File | Isi |
|---|---|
| `main.js` | proses utama Electron: control window, output window fullscreen per-display, IPC |
| `preload.js` | bridge aman (getDisplays, openOutput, closeOutput, sendSettings, onSettings) |
| `pipeline.js` | kamera → MediaPipe ImageSegmenter (selfie) → buffer kerja (rasio kamera) → efek per-piksel → blit cover-crop ke layar → lapis vektor/HUD; fallback luminance/motion; audio analyser; blob tracking latar |
| `effects.js` | port langsung efek Android: PointCloud, Volumetric, Triangulate, PixelLines, Scan, Recon + Palette / Plexus / WaveformHud / HvftHud |
| `effects_grid_backup.js`, `pipeline_grid_backup.js` | versi lama (pendekatan grid) — arsip, tidak dipakai |
| `control.html/js` | UI kontrol + preview (panel Setting bisa disembunyikan) |
| `output.html/js` | render fullscreen di monitor kedua, terima setting via IPC |

## Sumber & overlay

- **Playlist** di bawah preview: `KAMERA` + media yang kamu tambahkan.
  `+ MEDIA` atau **drag & drop** file ke jendela. Klik = pakai sebagai sumber,
  **shift-klik = hapus** dari daftar. Video di-loop otomatis.
- Semua efek bekerja pada sumber apa pun, karena segmentasi dijalankan pada
  **kanvas kerja** (bukan elemen video) — jadi kamera, file video, dan gambar
  diperlakukan sama.
- **Overlay** (logo band, video kedua) di panel: pilih file, atur ukuran,
  opacity, posisi X/Y, blend (Screen / Normal / Multiply), bisa ditaruh
  **di belakang** efek, dan ukurannya bisa berdenyut mengikuti onset audio.
- Jendela output monitor kedua ikut sumber & overlay dari jendela kontrol
  (dikirim sebagai path file, jadi keduanya memuat file yang sama).

## Kontrol

- Tombol efek di dock bawah, atau tombol angka **1–6**
  (Point Cloud, Triangulate, Volumetric, Pixel Lines, Scan, Recon)
- **S** buka/tutup panel Setting · **H** HUD on/off · **F** kirim ke monitor 2 · **R** rekam
- **⇧1–6** muat preset. Di panel: klik slot = muat, shift-klik = simpan.
  Tersimpan di `~/Library/Application Support/HVFT VISION/presets.json`,
  jadi tetap ada walau `node_modules` dihapus.
- Panel juga punya **MASK SUBJEK** (Auto / Normal / Balik) kalau deteksi
  polaritas mask meleset, **TAMPILAN PREVIEW** (Muat / Isi penuh) dan
  **RESOLUSI EFEK** (640 / 960 / 1280).
- Panel Setting adalah sidebar tetap, bukan pop-up; preview mengisi sisa lebar
  window. Jendela output ke monitor kedua selalu isi penuh.
- Panel Setting: pemilih kamera (Mac + iPhone Continuity), Mirror, warna objek
  (Putih/Biru/Gray), slider **Latar** (gelap→kamera) & **Sensitivitas**,
  Blob tracking latar (Off/Putih/Hijau), pemilih display + "Kirim ke Monitor", mic.

## Kamera iPhone (Continuity)

iPhone yang aktif Continuity Camera muncul otomatis di daftar kamera
(`enumerateDevices`). Kalau belum muncul: pastikan Wi-Fi/Bluetooth aktif, iPhone
terkunci & dekat Mac, lalu buka lagi panel Setting (daftar auto-refresh saat
`devicechange`).

## Model segmentasi (opsional offline)

Default: model dimuat dari CDN saat pertama jalan. Untuk DMG yang jalan tanpa
internet, vendorkan file berikut:

```
vendor/tasks-vision/vision_bundle.mjs      # dari @mediapipe/tasks-vision@0.10.14
vendor/tasks-vision/wasm/                  # folder wasm dari paket yang sama
vendor/models/selfie_segmenter.tflite      # model selfie segmenter (float16)
```

`pipeline.js` mencoba path lokal dulu, baru CDN, baru fallback luminance.

## Rekaman

Tombol REKAM merekam canvas (30fps, + mic bila diaktifkan) dan menyimpan file
ke folder Downloads (`.mp4` bila didukung, selain itu `.webm`).

## Reaksi audio

Berbasis **frekuensi**, bukan amplitudo/dB — musik noise punya level nyaris rata
terus-menerus sehingga dB tidak informatif; yang berubah adalah sebaran spektrum.

- **Pita**: low 20–250 Hz, mid 250–2 k, high 2 k–10 k (pilih salah satu atau Semua)
- **Spectral flux**: jumlah kenaikan energi antar-frame → `onset` saat
  `flux > rata-rata·1.6 + 0.004`, meluruh ×0.86 (envelope dari AudioBeat.kt)
- **Centroid**: pusat massa spektrum, tersedia untuk pemakaian berikutnya
- **Indikator** di panel: spektrum skala log 20 Hz–10 kHz dengan penanda batas
  pita, angka low/mid/high/flux, dan lampu ONSET — bukan meter dB

Empat tujuan, masing-masing bisa dimatikan:

| Toggle | Yang digerakkan |
|---|---|
| Kerapatan | energi pita terpilih menaikkan ambang dither + breathe (Point Cloud, Volumetric) |
| Letupan | `onset` melebarkan sebaran tepi siluet sampai 3,2×; di Constellation membesarkan titik |
| Strobe | kilat aditif seluruh layar, kuat `onset²·0.45` |
| Jaring | energi pita mengatur jarak sambung garis Constellation |

Slider **Intensitas Audio** menskala kelimanya sekaligus. Tekan **Aktifkan Mic**
dulu; tanpa izin mikrofon semuanya diam dan efek kembali ke perilaku Android.

## Catatan port dari Android

Efek diambil dari `HVFT_PROJECTS/2_HVFT_VISION` (Kotlin) dan dipertahankan
apa adanya: fungsi `hash` yang sama, ambang dither `hash(x,y)&1023 < sens+lum*k`,
`Palette.tint` (Putih / Biru 0.35,0.70,1.0 / Gray 0.86,0.90,1.0), Plexus,
WaveformHud, HvftHud. Dua lapis render:

- `pixels(f)` — per-piksel di buffer resolusi kerja (640/960/1280, bisa dipilih)
- `vector(ctx,f,D)` — garis, angka, HUD digambar di resolusi layar supaya tajam

Perbedaan yang disengaja:
- **Recon dihapus** (permintaan) — ganti **Constellation**, diport dari
  `ConstellationRenderer.kt` di project VisiFX: titik tepi gradien di dalam
  subjek, saling terhubung bila lebih dekat dari 0.30× sisi bbox, hub di centroid.
- **Panel waveform dihapus** dari kanvas; indikator audio pindah ke panel.
- `BlobTracker.kt` diport penuh: flood-fill blob, glide 0.35 antar-frame,
  garis penghubung sejauh `W·(0.35 + beat·0.2)`, label TRK — dengan slider
  **Tebal Garis Blob**.
- `GroundPlane.dotGridMasked` diport: garis tipis + titik di perempatan yang
  dilewati saat jatuh di atas subjek, kerapatan bisa diatur.

## Belum dikerjakan (next)

- Warp/keystone untuk projection mapping di output window
- Pemakaian `centroid` spektrum (mis. warna/ukuran titik ikut terang-gelapnya bunyi)
- Grain/glow siluet dengan shader WebGL (sekarang additive Canvas 2D)
- Code signing + notarization untuk distribusi DMG di luar mesin sendiri

## Troubleshooting macOS

**"Malware Blocked and Moved to Trash — Electron.app"**
Bukan malware sungguhan. XProtect (antivirus bawaan macOS) rutin memperbarui
aturan YARA-nya, dan biner Electron versi lama bisa mendadak gagal validasi.
Solusinya pakai Electron terbaru, bukan mematikan Gatekeeper:

```bash
softwareupdate --install --all          # pastikan aturan XProtect terbaru
rm -rf node_modules package-lock.json
npm cache clean --force
npm install                             # package.json sudah dipatok electron ^44
npx electron --version                  # cek biner jalan
```

Kalau Electron.app terlanjur masuk Trash, biarkan saja — `npm install` mengunduh
ulang yang baru. Jangan pulihkan dari Trash.

**`node -v` abort: `Library not loaded: @rpath/libuv.1.dylib`**
`node` yang kepanggil adalah salinan di cache `pkgs/` conda, bukan yang ter-link
di environment. Cek `hash -r && which -a node`; kalau `/opt/miniconda3/bin/node`
juga gagal, hapus nodejs conda (`conda remove -y nodejs`) dan pasang Node LTS
dari installer resmi nodejs.org (macOS Apple Silicon .pkg).

**`cd` gagal padahal path benar** — lihat catatan tanda kutip di bagian 1.

**`ERR_REQUIRE_ESM` saat `npm install` (Electron gagal terpasang)**
Node 22.6 terlalu tua: installer Electron modern memakai `@electron/get` yang
sudah ESM-only, dan `require()` atas modul ESM baru didukung sejak Node 22.12+.
Naikkan Node ke LTS (24.x) lalu pasang ulang:

```bash
conda remove -y nodejs                  # buang node conda yang bermasalah
# pasang Node LTS dari installer resmi nodejs.org (macOS Apple Silicon .pkg)
# lalu buka Terminal BARU:
node -v                                 # harus v24.x
rm -rf node_modules package-lock.json
npm install
npx electron --version
```
