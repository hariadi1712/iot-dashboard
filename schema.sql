-- ============================================================
-- KEBUN JAYA — Skema Database v2 (2 sistem irigasi kembar)
-- Sistem: 'gh' dan 'of2'. Tiap sistem punya controller + dosing.
-- Device: gh, of2, doser_gh, doser_of2 (4 total).
-- Jalankan di DATABASE BARU terpisah dari Petani Pizza.
-- ============================================================

CREATE TABLE devices (
  id         VARCHAR(16) PRIMARY KEY,          -- gh | of2 | doser_gh | doser_of2
  system     VARCHAR(8)  NOT NULL,             -- 'gh' | 'of2' (sistem induk)
  role       VARCHAR(16) NOT NULL,             -- 'controller' | 'doser'
  name       VARCHAR(64) NOT NULL,
  api_key    CHAR(64)    NOT NULL UNIQUE,
  last_seen  DATETIME    NULL,
  KEY idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE telemetry (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(16) NOT NULL,
  ts        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data      JSON        NOT NULL,
  KEY idx_dev_ts (device_id, ts),
  CONSTRAINT fk_tel_dev FOREIGN KEY (device_id) REFERENCES devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commands (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id  VARCHAR(16)  NOT NULL,
  type       VARCHAR(24)  NOT NULL,
  payload    JSON         NOT NULL,
  status     ENUM('pending','acked','done','failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acked_at   DATETIME     NULL,
  result     JSON         NULL,
  KEY idx_dev_status (device_id, status, id),
  CONSTRAINT fk_cmd_dev FOREIGN KEY (device_id) REFERENCES devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Jadwal PER SISTEM (gh & of2 punya jadwal sendiri, jam berbeda
-- supaya tidak nyala bersamaan / listrik trip)
CREATE TABLE schedules (
  id      BIGINT UNSIGNED PRIMARY KEY,          -- id dari frontend (Date.now())
  system  VARCHAR(8)   NOT NULL,                -- 'gh' | 'of2'
  time    CHAR(5)      NOT NULL,                -- 'HH:MM'
  liters  DECIMAL(7,1) NOT NULL,
  days    JSON         NOT NULL,                -- [0..6], 0=Minggu
  enabled TINYINT(1)   NOT NULL DEFAULT 1,
  KEY idx_system (system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE app_config (
  k VARCHAR(48) PRIMARY KEY,
  v JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Versi jadwal & konfigurasi dosing PER SISTEM
INSERT INTO app_config (k, v) VALUES
  ('sched_version:gh',  '1'),
  ('sched_version:of2', '1'),
  ('dose_config:gh', JSON_OBJECT('konsA',10,'konsB',10,'refEC',2.0,'targetEC',2.0,'autoDose',true,'useRawSensor',true)),
  ('dose_config:of2', JSON_OBJECT('konsA',10,'konsB',10,'refEC',2.0,'targetEC',2.0,'autoDose',true,'useRawSensor',true));

-- History irigasi PER SISTEM per hari
CREATE TABLE irrigation_history (
  system VARCHAR(8)   NOT NULL,
  d      DATE         NOT NULL,
  liters DECIMAL(8,1) NOT NULL DEFAULT 0,
  freq   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (system, d)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dose_history (
  id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  system VARCHAR(8)   NOT NULL,
  ts     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  a_l    DECIMAL(6,2) NOT NULL,
  b_l    DECIMAL(6,2) NOT NULL,
  ec     DECIMAL(4,2) NULL,
  KEY idx_sys_ts (system, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('owner','operator') NOT NULL DEFAULT 'operator',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Device & user di-seed oleh setup.php.
