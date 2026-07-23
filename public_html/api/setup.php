<?php
// ============================================================
// SETUP SEKALI JALAN — /api/setup.php?token=TOKEN
// Membuat 4 device (gh, of2, doser_gh, doser_of2) + API key acak,
// dan user dashboard. HAPUS file ini setelah selesai.
// ============================================================
declare(strict_types=1);
require __DIR__ . '/lib.php';

const SETUP_TOKEN = 'GANTI_DENGAN_STRING_ACAK_PANJANG';

const SEED_USERS = [
  ['username' => 'hariadi',  'password' => 'GANTI_PASSWORD_1', 'role' => 'owner'],
  ['username' => 'operator', 'password' => 'GANTI_PASSWORD_2', 'role' => 'operator'],
];

header('Content-Type: text/plain; charset=utf-8');

if (($_GET['token'] ?? '') !== SETUP_TOKEN || SETUP_TOKEN === 'GANTI_DENGAN_STRING_ACAK_PANJANG') {
  http_response_code(403);
  exit("Token salah, atau SETUP_TOKEN belum diganti dari nilai default.\n");
}

$pdo = db();
$exists = (int) $pdo->query('SELECT COUNT(*) c FROM devices')->fetch()['c'];
if ($exists > 0) {
  exit("Setup sudah pernah dijalankan (tabel devices tidak kosong). Hapus file ini.\n");
}

echo "=== KEBUN JAYA — SETUP (2 sistem, 4 device) ===\n\n";

$devices = [
  ['gh',        'gh',  'controller', 'GH — Irrigation'],
  ['doser_gh',  'gh',  'doser',      'GH — Smart Dosing'],
  ['of2',       'of2', 'controller', 'OF2 — Irrigation + Recharge'],
  ['doser_of2', 'of2', 'doser',      'OF2 — Smart Dosing'],
];
$st = $pdo->prepare('INSERT INTO devices (id, system, role, name, api_key) VALUES (?, ?, ?, ?, ?)');
echo "API KEY DEVICE — catat sekarang, tidak ditampilkan lagi:\n";
foreach ($devices as [$id, $sys, $role, $name]) {
  $key = bin2hex(random_bytes(32));
  $st->execute([$id, $sys, $role, $name, $key]);
  echo str_pad($id, 11) . " : $key\n";
}

echo "\nUSER DASHBOARD:\n";
$st = $pdo->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
foreach (SEED_USERS as $u) {
  $st->execute([$u['username'], password_hash($u['password'], PASSWORD_DEFAULT), $u['role']]);
  echo "  {$u['username']} ({$u['role']})\n";
}

echo "\nCatatan: doser_gh boleh dibiarkan OFFLINE dulu kalau firmware\n";
echo "dosing GH belum diflash — sistem tetap jalan.\n";
echo "\nSelesai. SEKARANG HAPUS /api/setup.php DARI SERVER.\n";
