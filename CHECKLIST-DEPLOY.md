# Checklist Deploy — Kebun Jaya IoT @ iot.petanipizza.xyz

Centang berurutan. Jangan lompat — beberapa langkah bergantung pada langkah sebelumnya.

## A. Database (hPanel → Databases → MySQL)
- [ ] Buat database MySQL BARU (mis. `u977038945_kebunjaya`)
- [ ] Buat user MySQL BARU + password kuat — **JANGAN pakai user Petani Pizza**
- [ ] Beri user itu akses penuh ke DB baru
- [ ] Catat: nama DB, nama user, password
- [ ] phpMyAdmin → pilih DB baru → Import → `schema.sql` → Go
- [ ] Konfirmasi muncul 8 tabel (devices, telemetry, commands, schedules, app_config, irrigation_history, dose_history, users)

## B. Upload file (FileZilla / File Manager)
- [ ] Upload SELURUH isi folder `public_html/` dari paket
      KE DALAM `/home/u977038945/domains/petanipizza.xyz/public_html/iot`
      (bukan ke public_html utama)
- [ ] Struktur akhir di server:
      `.../iot/index.html`, `.../iot/assets/app.js`, `.../iot/api/*.php`, `.../iot/.htaccess`

## C. Konfigurasi backend
- [ ] Rename `iot/api/config.sample.php` → `iot/api/config.php`
- [ ] Isi di config.php: `db_host` (localhost), `db_name`, `db_user`, `db_pass`
- [ ] Edit `iot/api/setup.php`:
  - [ ] Ganti `SETUP_TOKEN` dengan string acak panjang (≥24 karakter)
  - [ ] Ganti `GANTI_PASSWORD_1` (login owner) & `GANTI_PASSWORD_2` (login operator)

## D. SSL (WAJIB sebelum jalan — firmware pakai HTTPS)
- [ ] hPanel → subdomain iot.petanipizza.xyz → aktifkan SSL (Let's Encrypt)
- [ ] Tunggu sampai `https://iot.petanipizza.xyz` bisa dibuka tanpa warning

## E. Inisialisasi (sekali jalan)
- [ ] Buka: `https://iot.petanipizza.xyz/api/setup.php?token=TOKEN_KAMU`
- [ ] CATAT 4 API key: `gh`, `doser_gh`, `of2`, `doser_of2`
- [ ] **HAPUS `iot/api/setup.php` dari server** (hari ini juga)

## F. Uji backend cepat (sebelum firmware)
- [ ] Buka `https://iot.petanipizza.xyz/` → muncul layar login
- [ ] Login dengan user owner → muncul dashboard 2 panel (GH & OF2)
- [ ] Semua device tampil OFFLINE — INI NORMAL (firmware belum kirim data)
- [ ] Jika `/api/state` error 404 → kabari, kemungkinan RewriteBase (fix 1 baris)

## G. Firmware (Arduino IDE — BERTAHAP, jangan serentak)
- [ ] Install library: ArduinoJson (v7), WiFiManager (tzapu), board esp32
- [ ] Buka `MasterGH.ino`:
  - [ ] `KJ_API_KEY` → isi key `gh` (KJ_API_BASE sudah benar: iot.petanipizza.xyz)
  - [ ] Flash ke ESP32 GH
  - [ ] Nyalakan → sambungkan WiFi via captive portal (SSID muncul di HP)
  - [ ] Cek dashboard: panel GH → device jadi ONLINE
- [ ] AMATI 1–2 MINGGU. Uji irigasi manual, cek jadwal fire.
- [ ] Baru lanjut `MasterOF2.ino` (key `of2`) — flash, amati
- [ ] Lalu `SmartDosing.ino` untuk doser_of2 (key `doser_of2`)
- [ ] (Opsional) dosing GH: `SmartDosing.ino` yang SAMA, key `doser_gh`

## H. Keselamatan fisik (TIDAK BISA DITAWAR)
- [ ] E-stop FISIK terpasang di panel, memutus daya pompa langsung,
      independen dari internet/server/firmware
- [ ] Set jam jadwal GH ≠ jam jadwal OF2 (hindari 2 pompa nyala bareng → MCB trip)

---
Catatan: backend v2 belum teruji integrasi end-to-end di lingkungan dev
(MySQL dev crash berulang). Langkah F adalah uji integrasi pertama yang nyata.
Dashboard belum diverifikasi di browser sungguhan — langkah F.2 sekaligus
verifikasi visual pertama.
