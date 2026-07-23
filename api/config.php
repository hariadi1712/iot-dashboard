<?php
// ============================================================
// Konfigurasi database — ISI MANUAL setelah deploy.
// Ganti nilai di bawah dengan kredensial MySQL dari Hostinger hPanel.
// ============================================================
return [
  'db_host' => 'localhost',
  'db_name' => 'CHANGE_ME',
  'db_user' => 'CHANGE_ME',
  'db_pass' => 'CHANGE_ME',

  // Berapa hari raw telemetry disimpan sebelum dihapus otomatis
  'telemetry_retention_days' => 14,

  // Device dianggap OFFLINE jika tidak kirim telemetry selama X detik
  'device_offline_after_s' => 30,
];
