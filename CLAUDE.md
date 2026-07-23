# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PHP backend + React dashboard for IoT irrigation system. Firmware ESP32 ada di repo terpisah: https://github.com/hariadi1712/iot-firmware

## Repository Structure (flat — langsung upload ke Hostinger subdomain)

```
(root)
├── index.html              # Dashboard entry
├── admin.html              # Admin panel
├── sw.js                  # Service worker (PWA)
├── manifest.webmanifest
├── .htaccess              # HTTPS redirect + cache
├── api/
│   ├── index.php          # All API endpoints
│   ├── lib.php            # Shared helpers (db, auth, config)
│   ├── config.php         # Database credentials (NEVER commit)
│   └── config.sample.php
├── assets/
│   ├── app.js            # Bundled React (rebuild dari src/ setelah edit UI)
│   ├── logo.png
│   └── icons/
├── src/
│   ├── main.jsx          # React entry point
│   └── App.jsx           # Dashboard component
├── .well-known/          # SSL certs (Hostinger auto-managed)
├── schema.sql             # MySQL schema (import via phpMyAdmin)
└── .gitignore
```

## Common Commands

### Rebuild React Bundle
```bash
npx esbuild src/main.jsx --bundle --minify --target=es2018 \
  --outfile=assets/app.js \
  --define:process.env.NODE_ENV='"production"'
```
Setelah rebuild, naikkan `?v=` di `index.html` supaya cache browser user refresh.

### Git
```bash
git add .
git commit -m "Deskripsi perubahan"
git push
```

## Deploy Checklist (Hostinger Git)

1. Buat subdomain baru di Hostinger
2. Hubungkan subdomain ke repo GitHub ini
3. Pilih branch (`dev` untuk dev, `main` untuk production)
4. Hostinger auto-pull saat push

**File lokal yang dipertahankan saat pull (tidak overwrite):**
- `api/config.php` — database credentials
- `.well-known/` — SSL certificates

**Setelah clone/pull pertama:**
1. Import `schema.sql` via phpMyAdmin
2. Buat `api/config.php` dari `config.sample.php`
3. Jalankan `api/setup.php` → catat API key → **HAPUS setup.php**

## Architecture Notes

### Backend API Endpoints
- `POST /api/telemetry` — device pushes sensor data
- `GET /api/commands/pending` — device polls commands
- `POST /api/commands/ack` — device confirms execution
- `GET /api/schedules/sync?ver=N` — device syncs schedules
- `POST /api/event` — device reports completion

### Dashboard Mode
- `LIVE = true` (default): short-poll `/api/state` tiap 5 detik
- `LIVE = false`: mock ticker tanpa backend (untuk demo)

## Sensitive Files (never commit)
- `api/config.php` — database credentials
- `Token.txt`
- `node_modules/`
- `.well-known/` — SSL certs
