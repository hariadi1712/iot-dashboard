<?php
// ============================================================
// KEBUN JAYA API — helper bersama
// ============================================================
declare(strict_types=1);

function cfg(): array {
  static $c = null;
  if ($c === null) {
    $f = __DIR__ . '/config.php';
    if (!file_exists($f)) json_err(500, 'config.php belum dibuat — rename config.sample.php');
    $c = require $f;
  }
  return $c;
}

// Nilai config yang bisa di-override dari admin UI (app_config: "override:KEY").
// Kalau tidak ada override, pakai nilai dari file config.php.
function cfg_val(string $key) {
  $ov = get_config_val("override:$key", null);
  if ($ov !== null) return $ov;
  $c = cfg();
  return $c[$key] ?? null;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $c = cfg();
    $pdo = new PDO(
      "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
      $c['db_user'], $c['db_pass'],
      [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      ]
    );
  }
  return $pdo;
}

function json_ok($data = ['ok' => true], int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function json_err(int $code, string $msg): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

function body_json(): array {
  $raw = file_get_contents('php://input');
  $d = json_decode($raw ?: '{}', true);
  if (!is_array($d)) json_err(400, 'Body bukan JSON valid');
  return $d;
}

// ---------- Auth: pengguna dashboard (session) ----------
function start_session(): void {
  if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
      'lifetime' => 60 * 60 * 24 * 30,
      'path' => '/',
      'httponly' => true,
      'samesite' => 'Lax',
      'secure' => !empty($_SERVER['HTTPS']),
    ]);
    session_name('KJSESS');
    session_start();
  }
}

function require_user(): array {
  start_session();
  if (empty($_SESSION['uid'])) json_err(401, 'Belum login');
  return ['id' => $_SESSION['uid'], 'username' => $_SESSION['uname'] ?? '', 'role' => $_SESSION['role'] ?? 'operator'];
}

function require_owner(): array {
  $u = require_user();
  if (($u['role'] ?? '') !== 'owner') json_err(403, 'Khusus owner');
  return $u;
}

// ---------- Auth: device ESP32 (API key) ----------
function require_device(): array {
  $key = $_SERVER['HTTP_X_API_KEY'] ?? '';
  if ($key === '') json_err(401, 'X-API-Key wajib');
  $st = db()->prepare('SELECT id, system, role, name FROM devices WHERE api_key = ?');
  $st->execute([$key]);
  $dev = $st->fetch();
  if (!$dev) json_err(401, 'API key tidak dikenal');
  return $dev;
}

function touch_device(string $id): void {
  db()->prepare('UPDATE devices SET last_seen = NOW() WHERE id = ?')->execute([$id]);
}

// ---------- Util ----------
function get_config_val(string $k, $default = null) {
  $st = db()->prepare('SELECT v FROM app_config WHERE k = ?');
  $st->execute([$k]);
  $r = $st->fetch();
  return $r ? json_decode($r['v'], true) : $default;
}

function set_config_val(string $k, $v): void {
  $st = db()->prepare('INSERT INTO app_config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
  $st->execute([$k, json_encode($v)]);
}

function bump_sched_version(): int {
  $v = (int) get_config_val('sched_version', 1) + 1;
  set_config_val('sched_version', $v);
  return $v;
}
