# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PHP backend + React dashboard for IoT irrigation system — two independent growing systems (GH & OF2). Firmware ESP32 ada di repo terpisah: https://github.com/hariadi1712/iot-firmware

## Repository Structure (flat deployment)

```
(root — langsung upload ke Hostinger subdomain)
├── index.html          # Dashboard entry
├── admin.html          # Admin panel
├── sw.js               # Service worker (PWA)
├── manifest.webmanifest
├── .htaccess          # HTTPS redirect + cache
├── api/
│   ├── index.php       # All API endpoints
│   ├── lib.php        # Shared helpers (db, auth, config)
│   ├── config.php     # Database credentials (NEVER commit)
│   └── config.sample.php
├── assets/
│   ├── app.js         # Bundled React (rebuild dari src/ setelah edit UI)
│   ├── logo.png
│   └── icons/
├── src/
│   ├── main.jsx       # React entry point
│   └── App.jsx         # Dashboard React component
└── schema.sql         # MySQL schema (import sekali via phpMyAdmin)
```

## Common Commands

### Rebuild React Bundle (setelah edit UI)
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

## Architecture Notes

### Backend API Endpoints
- `POST /api/telemetry` — device pushes sensor data
- `GET /api/commands/pending` — device polls commands
- `POST /api/commands/ack` — device confirms execution
- `GET /api/schedules/sync?ver=N` — device syncs schedules
- `POST /api/event` — device reports completion

### User Auth
- Session-based (`PHPSESSID`), 30 hari lifetime
- Role: `owner` (full access) vs `operator` (dashboard only)

### Dashboard Mode
- `LIVE = true` (default): short-poll `/api/state` tiap 5 detik
- `LIVE = false`: mock ticker tanpa backend (untuk demo)

## Deploy Checklist

1. Buat subdomain di Hostinger (bukan addon domain)
2. Buat database MySQL baru + user
3. Import `schema.sql` via phpMyAdmin
4. Copy file repo ke root subdomain (via FileZilla/SFTP)
5. Rename `api/config.sample.php` → `api/config.php`, isi kredensial DB
6. Buka `api/setup.php?token=TOKEN`, catat API key → **HAPUS setup.php**
7. Rebuild React bundle kalau edit UI (`npx esbuild ...`)

## Sensitive Files (never commit)
- `api/config.php` — database credentials
- `api/setup.php` — hapus setelah setup
- `Token.txt`
- `node_modules/`
- `.well-known/` — SSL certs
