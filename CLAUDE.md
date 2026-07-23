# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IoT irrigation system for Kebun Jaya — two independent growing systems (GH & OF2), each with:
- **ESP32 controller** (irrigation, tank level, pressure, recharge)
- **ESP32 SmartDosing** (nutrient A/B injection)
- **PHP dashboard** + **React frontend** (Hostinger shared hosting)

## Repository Structure

```
firmware-produksi/
├── MasterGH/          # GH controller (ESP32). Irrigation + recharge GH.
│   ├── MasterGH.ino  # Main sketch — state machine, sensors, relay control
│   ├── KJApi.h        # HTTP transport layer (telemetry, commands, schedules)
│   └── KJScheduler.h # Local schedule storage (NVS, offline-first)
├── MasterOF2/         # OF2 controller (ESP32). Irrigation + recharge sumur bor.
│   ├── MasterOF2.ino  # Differs from GH: motorized valve (18s travel), UDP sync
│   └── KJApi.h
└── SmartDosing/      # Nutrient doser (ESP32). Auto-dose from raw water volume.
    ├── SmartDosing.ino
    └── KJApi.h

kebunjaya-deploy/
├── src/App.jsx       # React dashboard — two systems (gh / of2), 4 tabs
├── public_html/
│   ├── api/
│   │   ├── index.php # All API endpoints
│   │   ├── lib.php   # Shared helpers (db, auth, config)
│   │   └── config.sample.php
│   └── assets/app.js # Bundled React (rebuild after editing App.jsx)
└── schema.sql         # MySQL schema (import once via phpMyAdmin)
```

## Common Commands

### Dashboard Frontend
```bash
# Edit UI → rebuild bundle
npx esbuild src/main.jsx --bundle --minify --target=es2018 \
  --outfile=public_html/assets/app.js \
  --define:process.env.NODE_ENV='"production"'

# Increment cache-bust version in public_html/index.html after rebuild
```

### Firmware (via Arduino IDE or arduino-cli)
```bash
# Compile check (example for MasterGH)
arduino-cli compile --fqbn esp32:esp32:esp32 \
  --library "ArduinoJson@7.x" \
  --library "WiFiManager" \
  firmware-produksi/MasterGH/

# Flash
arduino-cli upload -p /dev/ttyUSB0 --fqbn esp32:esp32:esp32 \
  firmware-produksi/MasterGH/
```

### Git
```bash
git init
git add .
git commit -m "Initial commit"
```

## Architecture Notes

### Firmware → Backend Contract
Devices communicate via REST (not MQTT). Endpoints:
- `POST /api/telemetry` — device pushes sensor data (7s interval)
- `GET /api/commands/pending` — device polls commands (2s interval)
- `POST /api/commands/ack` — device confirms command execution
- `GET /api/schedules/sync?ver=N` — device syncs schedules from server
- `POST /api/event` — device reports irrigation/dosing completion

**API key per device** (from `setup.php` output):
- GH controller → `gh` key
- OF2 controller → `of2` key
- SmartDosing GH → `doser_gh` key
- SmartDosing OF2 → `doser_of2` key

### Offline-First Design
Schedules and irrigation logic run 100% locally on ESP32 (NTP-based, stored in NVS). Server is only for:
- Remote command dispatch (E-stop, manual irrigation)
- Schedule configuration sync
- Telemetry persistence & dashboard display

### UDP Local Sync
GH broadcasts `floatRAW` status via UDP port 4210 → OF2 receives it to control pompa RAW. This path is LOCAL and must NOT be routed through the backend server.

### SmartDosing Auto-Dose
Controller broadcasts cumulative raw water volume via UDP. SmartDosing listens, detects 10L increments, and triggers A/B injection automatically. `RAWVOL_PREFIX` in SmartDosing.ino must match the controller ("GH:RAWVOL=" or "OF2:RAWVOL=") to prevent cross-system dosing.

## Before Production

1. Set `KJ_API_KEY` in all three firmware sketches
2. Set `RAWVOL_PREFIX` in SmartDosing.ino ("GH:RAWVOL=" or "OF2:RAWVOL=")
3. Run `setup.php` on server → save the 3 API keys → **DELETE setup.php**
4. Flash firmware **one device at a time**, observe 1-2 weeks before next
5. GH must be flashed first, then OF2, then SmartDosing units

## Sensitive Files (never commit)
- `public_html/api/config.php` (database credentials)
- `firmware-produksi/*/KJApi.h` — contains `KJ_API_KEY` values per device
- `Token.txt`
- `node_modules/`
