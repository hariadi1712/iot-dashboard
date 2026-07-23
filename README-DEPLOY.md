# Kebun Jaya — Panduan Deploy (Hostinger Shared Hosting)

Paket ini berisi semua yang dibutuhkan untuk menjalankan dashboard + backend
di shared hosting yang sudah ada (satu akun dengan Petani Pizza), sesuai PRD.

```
kebunjaya-deploy/
├── schema.sql                  ← import ke database BARU via phpMyAdmin
├── public_html/                ← upload SELURUH isi folder ini ke root subdomain
│   ├── index.html
│   ├── .htaccess               ← paksa HTTPS + cache asset
│   ├── assets/app.js           ← frontend React (sudah di-bundle, tanpa build step)
│   └── api/
│       ├── .htaccess           ← routing /api/* + blokir file sensitif
│       ├── index.php           ← semua endpoint API
│       ├── lib.php
│       ├── config.sample.php   ← rename jadi config.php, isi kredensial
│       └── setup.php           ← jalankan SEKALI, lalu HAPUS
└── src/                        ← source frontend (untuk edit di masa depan)
```

## Langkah deploy (±15 menit)

1. **Buat subdomain** di hPanel (mis. `kebunjaya.domainmu.com`) — subdomain
   biasa, BUKAN addon domain, supaya tidak memakan kuota 3 website.

2. **Buat database + user MySQL baru** di hPanel → Databases.
   ⚠️ Jangan reuse user database Petani Pizza — isolasi ini disengaja
   (PRD §7): kalau salah satu endpoint kena eksploitasi, attacker tidak
   bisa pivot ke database pembayaran.

3. **Import `schema.sql`** ke database baru via phpMyAdmin.

4. **Upload isi `public_html/`** ke root subdomain via FileZilla/SFTP.

5. **Rename `api/config.sample.php` → `api/config.php`**, isi kredensial
   database dari langkah 2.

6. **Edit `api/setup.php`:** ganti `SETUP_TOKEN` dengan string acak dan
   ganti kedua password user. Lalu buka di browser:
   `https://kebunjaya.domainmu.com/api/setup.php?token=TOKENMU`
   → **catat 3 API key device yang ditampilkan** (dipakai firmware ESP32).

7. **HAPUS `api/setup.php` dari server.** Wajib, jangan ditunda.

8. Buka subdomain di browser → layar login → masuk dengan user yang di-seed.
   Semua device akan tampil OFFLINE sampai firmware mulai mengirim telemetry
   — itu normal.

## Kontrak integrasi firmware ESP32 (untuk milestone M5)

Semua request device wajib header `X-API-Key: <key dari setup.php>`.
Interval sesuai PRD §9: telemetry tiap 5–10 dtk, cek command tiap 1–2 dtk.

### 1. Kirim telemetry — `POST /api/telemetry`
Body JSON bebas; kirim field dengan NAMA YANG DIPAKAI FRONTEND.
Pemetaan dari variabel firmware lama:

| Firmware (Arduino Cloud) | Kirim sebagai | Device |
|---|---|---|
| tankOF2Liters            | tankL         | of2    |
| pressurePsi              | psi           | gh     |
| r3PumpDistribusi         | pumpDist      | gh     |
| r6Solenoid (valve)       | valveOpen     | gh     |
| pumpRAW / r2PumpOF2      | pumpRAW / pumpOF2 | of2 |
| pumpA_on / pumpB_on      | pumpDoseA / pumpDoseB | doser |
| floatRAW / floatOF2      | floatRAW / floatOF2 | of2 |
| estopIrrigActive         | estop         | gh     |
| statusText               | status        | gh     |
| irrDailyLiters / irrDailyFreq | todayL / todayFreq | gh |
| (EC Modbus)              | ecMeasured, tdsMeasured, ecTemp, ecSensorOK, ecRaw | gh |
| (diagnostik)             | rssi, heapKb, uptimeH, usOK, usLastCm, pressOK, flowOK, flowLpm, floatOF2OK, floatRAWSynced, floatRAWAgeS | masing-masing |

Contoh (device gh):
```json
{"tankL":742,"psi":8.4,"pumpDist":false,"valveOpen":false,
 "estop":false,"status":"READY","ecMeasured":1.96,"tdsMeasured":980,
 "ecTemp":27.4,"ecSensorOK":true,"ecRaw":0.31,"rssi":-61,
 "heapKb":176,"uptimeH":37.4}
```

### 2. Ambil perintah — `GET /api/commands/pending`
Respons: `{"commands":[{"id":12,"type":"irrigate","payload":{"liters":120}}]}`
Tipe: `irrigate, valve, pump_dist, recharge, estop, dose, dose_config`.
Eksekusi HANYA lewat state machine + guard yang sudah ada di firmware
(cooldown, fault sensor, e-stop) — server tidak mem-bypass apa pun.

### 3. Konfirmasi — `POST /api/commands/ack`
```json
{"id":12,"status":"done","result":{"note":"selesai 120 L"}}
```
Status: `acked` (diterima), `done` (selesai), `failed` (ditolak guard).
Command yang tidak di-ack tetap `pending` dan akan dikirim ulang saat poll
berikutnya — idempoten di sisi device itu tanggung jawab firmware
(cek: command id yang sama jangan dieksekusi dua kali).

### 4. Sync jadwal (device gh saja) — `GET /api/schedules/sync?ver=N`
Kirim versi jadwal lokal (NVS). Jika server lebih baru:
`{"version":8,"changed":true,"schedules":[{"time":"06:00","liters":120,"days":[1,2,3,4,5]}]}`
→ tulis ulang seluruh daftar di NVS + simpan versi. Jika sama:
`{"version":8,"changed":false}`. Eksekusi jadwal 100% lokal di device
(RTC/NTP) — sync hanya untuk perubahan konfigurasi (PRD §13.3).

### 5. Lapor event history — `POST /api/event`
Setelah irigasi selesai: `{"type":"irrigation_done","liters":120}`
Setelah dosing selesai: `{"type":"dose_done","a":2.5,"b":2.5,"ec":1.98}`

## Catatan operasional

- **Retensi telemetry:** raw dihapus otomatis setelah `telemetry_retention_days`
  (default 14 hari, ubah di config.php). History harian & dosing permanen.
- **Device dianggap OFFLINE** jika tidak kirim telemetry > 30 dtk
  (`device_offline_after_s`).
- **E-STOP dari dashboard** difanout ke ketiga device lewat command queue —
  delay maksimal = interval poll command device. Ini LAPISAN KEDUA;
  e-stop fisik di panel tetap wajib dan tidak tergantikan (PRD §8).
- **Edit frontend:** ubah `src/App.jsx`, lalu build ulang:
  `npx esbuild src/main.jsx --bundle --minify --target=es2018
   --outfile=public_html/assets/app.js --define:process.env.NODE_ENV='"production"'`
  dan naikkan `?v=` di index.html supaya cache pengguna ter-refresh.
- **Mode simulasi:** set `LIVE = false` di baris atas `src/App.jsx` + build
  ulang — berguna untuk demo tanpa backend.

---

## UPDATE v2: Model 2 sistem irigasi kembar

Backend kini melayani **dua sistem independen** (gh & of2), masing-masing
dengan jadwal, history, dan konfigurasi dosing sendiri. Total 4 device:
`gh`, `doser_gh`, `of2`, `doser_of2`.

**Perubahan kontrak API dari v1:**
- `POST /api/command` sekarang WAJIB menyertakan `"system": "gh"|"of2"`
  di body, selain `type` dan `payload`. Backend merutекан ke device yang
  benar dalam sistem itu.
- `POST /api/schedules` juga wajib `"system"`.
- `GET /api/state` mengembalikan `{"systems": {"gh": {...}, "of2": {...}}}`
  — bukan lagi objek datar. Tiap sistem punya blok telemetry, jadwal,
  history, dan status online (ctrlOnline + doserOnline) sendiri.
- E-stop per panel: `command` type `estop` dengan `system:"gh"` menghentikan
  gh + doser_gh; `system:"of2"` menghentikan of2 + doser_of2.

**Device sync (firmware) tidak berubah bentuknya** — tetap pakai X-API-Key,
dan backend tahu sistem device dari API key-nya. `schedules/sync` dan
`event` otomatis nempel ke sistem milik device tersebut.

**doser_gh boleh OFFLINE** dulu kalau kamu belum flash dosing GH — panel GH
tetap berfungsi, cuma tab dosing-nya menampilkan unit offline.

Jam jadwal GH dan OF2 sebaiknya di-set BERBEDA supaya kedua pompa distribusi
tidak menyala bersamaan (mencegah lonjakan listrik / MCB trip). Backend &
firmware tidak memaksakan ini — itu keputusan operasional kamu saat mengisi
jadwal di masing-masing panel.
