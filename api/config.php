<?php
// ============================================================
// RENAME file ini menjadi config.php lalu isi kredensial.
// JANGAN pakai user MySQL yang sama dengan Petani Pizza.
// ============================================================
return [
  'db_host' => 'localhost',
  'db_name' => 'u977038945_IoT_PP',
  'db_user' => 'u977038945_Hariadi1712',
  'db_pass' => 'Kudabima123',

  // Berapa hari raw telemetry disimpan sebelum dihapus otomatis
  // (PRD open question #2 — default konservatif 14 hari; history harian permanen)
  'telemetry_retention_days' => 14,

  // Device dianggap OFFLINE jika tidak kirim telemetry selama X detik
  'device_offline_after_s' => 30,
];
