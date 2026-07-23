# Install ke HP (PWA) — P² LABS

Dashboard sekarang bisa "di-install" ke layar HP seperti aplikasi, tanpa Play Store.

## File PWA yang harus ter-upload (ke folder iot/)
- index.html (sudah diperbarui — link manifest + daftar service worker)
- manifest.webmanifest
- sw.js
- assets/logo.png
- assets/icons/ (semua: icon-192, icon-512, maskable-512, apple-touch-180, favicon-32)

## Cara install di Android (Chrome)
1. Buka https://iot.petanipizza.xyz/ di Chrome
2. Login
3. Menu titik-tiga → "Add to Home screen" / "Install app"
   (kadang muncul otomatis sebagai banner)
4. Ikon P² LABS muncul di home screen. Buka dari situ → fullscreen tanpa address bar.

## Cara install di iPhone (Safari)
1. Buka di Safari
2. Tombol Share (kotak panah ke atas) → "Add to Home Screen"

## Update aplikasi
Karena ini PWA, tiap kali kamu update app.js di server + naikkan ?v=,
aplikasi di HP ikut ter-update otomatis saat dibuka (service worker
mengambil versi baru). Tidak perlu install ulang.

## PENTING soal offline
Service worker HANYA men-cache tampilan (shell) supaya buka cepat.
Data kontrol & telemetry (/api/*) SELALU diambil live dari server —
tidak pernah di-cache. Jadi:
- Buka app tanpa sinyal → tampilan muncul, tapi data kosong/tidak update
- E-STOP & semua kontrol TETAP butuh internet. PWA tidak mengubah ini.
  E-stop fisik di panel tetap wajib.

## Bikin file APK (opsional, nanti)
Kalau perlu file .apk untuk dishare ke operator:
- Pakai PWABuilder.com (paling gampang, tinggal masukкан URL) atau
- Bubblewrap (butuh Android SDK)
Keduanya membungkus PWA ini jadi APK. Fondasinya sudah siap.
