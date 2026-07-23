<?php
// ============================================================
// KEBUN JAYA API — front controller v2 (2 sistem irigasi kembar)
// Routing: /api/{route} via .htaccess -> index.php?r={route}
//
// Sistem: 'gh' dan 'of2'. Command & jadwal & dosing bersifat per-sistem.
// E-stop per panel: estop gh -> {gh, doser_gh}; estop of2 -> {of2, doser_of2}.
// ============================================================
declare(strict_types=1);
require __DIR__ . '/lib.php';

$route  = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Controller & doser device id per sistem
function sys_devices(string $system): array {
  return $system === 'of2'
    ? ['controller' => 'of2', 'doser' => 'doser_of2']
    : ['controller' => 'gh',  'doser' => 'doser_gh'];
}
function valid_system(string $s): bool { return $s === 'gh' || $s === 'of2'; }

// Perintah -> device tujuan DALAM SATU SISTEM.
// estop menyentuh controller + doser sistem itu saja (per panel).
function route_targets(string $system, string $type): array {
  $d = sys_devices($system);
  switch ($type) {
    case 'irrigate':
    case 'valve':
    case 'pump_dist':
    case 'recharge':      // hanya bermakna di of2, tapi routing tetap ke controller
      return [$d['controller']];
    case 'estop':
      return [$d['controller'], $d['doser']];
    case 'dose':
    case 'dose_config':
    case 'autodose':      // toggle & konsentrasi auto-dose -> ke smartdosing
    case 'clean':         // cleaning cycle dosing -> ke smartdosing
      return [$d['doser']];
    default:
      return [];
  }
}

try {
  switch ("$method $route") {

    /* ================= AUTH DASHBOARD ================= */
    case 'POST login': {
      start_session();
      $b = body_json();
      $u = trim((string)($b['username'] ?? ''));
      $p = (string)($b['password'] ?? '');
      $_SESSION['tries'] = ($_SESSION['tries'] ?? 0) + 1;
      if ($_SESSION['tries'] > 20) json_err(429, 'Terlalu banyak percobaan');
      $st = db()->prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?');
      $st->execute([$u]);
      $row = $st->fetch();
      if (!$row || !password_verify($p, $row['password_hash'])) {
        json_err(401, 'Username atau password salah');
      }
      session_regenerate_id(true);
      $_SESSION['uid'] = (int)$row['id'];
      $_SESSION['uname'] = $row['username'];
      $_SESSION['role'] = $row['role'];
      $_SESSION['tries'] = 0;
      json_ok(['ok' => true, 'username' => $row['username'], 'role' => $row['role']]);
    }

    case 'POST logout': {
      start_session();
      session_destroy();
      json_ok();
    }

    /* ================= STATE (kedua sistem) ================= */
    case 'GET state': {
      require_user();
      $limit = (int) cfg_val('device_offline_after_s');

      // Peta online semua device
      $onl = [];
      foreach (db()->query('SELECT id, last_seen FROM devices') as $row) {
        $onl[$row['id']] = $row['last_seen'] !== null
          && (time() - strtotime($row['last_seen'])) <= $limit;
      }

      $out = ['systems' => []];
      foreach (['gh', 'of2'] as $sys) {
        $dev = sys_devices($sys);
        $s = [];

        // Telemetry controller
        $st = db()->prepare('SELECT data FROM telemetry WHERE device_id = ? ORDER BY id DESC LIMIT 1');
        $st->execute([$dev['controller']]);
        if ($row = $st->fetch()) $s = array_merge($s, json_decode($row['data'], true) ?: []);

        // Telemetry doser (hanya field dosing; tidak menimpa status controller)
        $st->execute([$dev['doser']]);
        if ($row = $st->fetch()) {
          $dd = json_decode($row['data'], true) ?: [];
          foreach (['pumpDoseA','pumpDoseB','doseTankA','doseTankB','doseCapA','doseCapB'] as $k) {
            if (array_key_exists($k, $dd)) $s[$k] = $dd[$k];
          }
        }

        $s['ctrlOnline']  = $onl[$dev['controller']] ?? false;
        $s['doserOnline'] = $onl[$dev['doser']] ?? false;
        $s['online']      = $s['ctrlOnline'];
        $s['hasRecharge'] = ($sys === 'of2'); // hanya OF2 punya recharge sumur bor

        // dose_config + jadwal per sistem
        $s = array_merge($s, get_config_val("dose_config:$sys", []));
        $s['schedVer'] = (int) get_config_val("sched_version:$sys", 1);
        $sch = db()->prepare('SELECT id, time, liters, days, enabled FROM schedules WHERE system = ? ORDER BY time');
        $sch->execute([$sys]);
        $s['schedules'] = array_map(fn($r) => [
          'id' => (int)$r['id'], 'time' => $r['time'], 'liters' => (float)$r['liters'],
          'days' => json_decode($r['days'], true), 'enabled' => (bool)$r['enabled'],
        ], $sch->fetchAll());

        // History irigasi 7 hari
        $h = db()->prepare(
          "SELECT d, liters, freq FROM irrigation_history
           WHERE system = ? AND d >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) ORDER BY d"
        );
        $h->execute([$sys]);
        $hari = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
        $s['history'] = array_map(fn($r) => [
          'd' => date('d/m', strtotime($r['d'])),
          'day' => $hari[(int)date('w', strtotime($r['d']))],
          'l' => (float)$r['liters'], 'f' => (int)$r['freq'],
        ], $h->fetchAll());

        // Riwayat dosing
        $dh = db()->prepare('SELECT ts, a_l, b_l, ec FROM dose_history WHERE system = ? ORDER BY id DESC LIMIT 10');
        $dh->execute([$sys]);
        $s['doseHistory'] = array_reverse(array_map(fn($r) => [
          'd' => date('d/m', strtotime($r['ts'])),
          'a' => (float)$r['a_l'], 'b' => (float)$r['b_l'],
          'ec' => $r['ec'] !== null ? (float)$r['ec'] : 0,
        ], $dh->fetchAll()));

        $out['systems'][$sys] = $s;
      }
      json_ok($out);
    }

    /* ================= COMMAND (butuh ?sys=) ================= */
    case 'POST command': {
      require_user();
      $b = body_json();
      $sys = (string)($b['system'] ?? '');
      $type = (string)($b['type'] ?? '');
      $payload = $b['payload'] ?? [];
      if (!valid_system($sys)) json_err(400, 'system harus gh atau of2');
      $targets = route_targets($sys, $type);
      if (!$targets) json_err(400, "Tipe perintah tidak dikenal: $type");

      if ($type === 'dose_config') {
        $curr = get_config_val("dose_config:$sys", []);
        set_config_val("dose_config:$sys", array_merge($curr, $payload));
      }

      $pdo = db();
      $st = $pdo->prepare('INSERT INTO commands (device_id, type, payload) VALUES (?, ?, ?)');
      $ids = [];
      foreach ($targets as $dev) {
        $st->execute([$dev, $type, json_encode($payload)]);
        $ids[] = (int)$pdo->lastInsertId();
      }
      json_ok(['ok' => true, 'command_ids' => $ids]);
    }

    /* ================= JADWAL per sistem ================= */
    case 'POST schedules': {
      require_user();
      $b = body_json();
      $sys = (string)($b['system'] ?? '');
      $list = $b['schedules'] ?? null;
      if (!valid_system($sys)) json_err(400, 'system harus gh atau of2');
      if (!is_array($list)) json_err(400, 'schedules wajib array');
      $pdo = db();
      $pdo->beginTransaction();
      try {
        $del = $pdo->prepare('DELETE FROM schedules WHERE system = ?');
        $del->execute([$sys]);
        $ins = $pdo->prepare('INSERT INTO schedules (id, system, time, liters, days, enabled) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($list as $s) {
          if (!preg_match('/^\d{2}:\d{2}$/', (string)($s['time'] ?? ''))) json_err(400, 'Format jam salah');
          $ins->execute([
            (int)$s['id'], $sys, $s['time'], (float)$s['liters'],
            json_encode(array_values(array_map('intval', $s['days'] ?? []))),
            !empty($s['enabled']) ? 1 : 0,
          ]);
        }
        $ver = (int) get_config_val("sched_version:$sys", 1) + 1;
        set_config_val("sched_version:$sys", $ver);
        $pdo->commit();
        json_ok(['ok' => true, 'version' => $ver]);
      } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
    }

    /* ================= ENDPOINT DEVICE (ESP32) ================= */
    case 'POST telemetry': {
      $dev = require_device();
      db()->prepare('INSERT INTO telemetry (device_id, data) VALUES (?, ?)')
        ->execute([$dev['id'], json_encode(body_json())]);
      touch_device($dev['id']);
      if (random_int(1, 100) === 1) {
        $days = (int) cfg_val('telemetry_retention_days');
        db()->prepare('DELETE FROM telemetry WHERE ts < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 500')
          ->execute([$days]);
      }
      json_ok();
    }

    case 'GET commands/pending': {
      $dev = require_device();
      touch_device($dev['id']);
      $st = db()->prepare(
        "SELECT id, type, payload FROM commands
         WHERE device_id = ? AND status = 'pending' ORDER BY id LIMIT 10"
      );
      $st->execute([$dev['id']]);
      json_ok(['commands' => array_map(fn($c) => [
        'id' => (int)$c['id'], 'type' => $c['type'],
        'payload' => json_decode($c['payload'], true),
      ], $st->fetchAll())]);
    }

    case 'POST commands/ack': {
      $dev = require_device();
      $b = body_json();
      $id = (int)($b['id'] ?? 0);
      $status = in_array($b['status'] ?? 'done', ['acked','done','failed'], true) ? $b['status'] : 'done';
      db()->prepare('UPDATE commands SET status = ?, acked_at = NOW(), result = ? WHERE id = ? AND device_id = ?')
        ->execute([$status, json_encode($b['result'] ?? null), $id, $dev['id']]);
      json_ok();
    }

    // Device controller sync jadwal sistemnya sendiri
    case 'GET schedules/sync': {
      $dev = require_device();
      touch_device($dev['id']);
      $sys = $dev['system'];
      $devVer = (int)($_GET['ver'] ?? 0);
      $srvVer = (int) get_config_val("sched_version:$sys", 1);
      if ($devVer >= $srvVer) json_ok(['version' => $srvVer, 'changed' => false]);
      $st = db()->prepare('SELECT time, liters, days FROM schedules WHERE system = ? AND enabled = 1 ORDER BY time');
      $st->execute([$sys]);
      json_ok([
        'version' => $srvVer, 'changed' => true,
        'schedules' => array_map(fn($s) => [
          'time' => $s['time'], 'liters' => (float)$s['liters'],
          'days' => json_decode($s['days'], true),
        ], $st->fetchAll()),
      ]);
    }

    case 'POST event': {
      $dev = require_device();
      $sys = $dev['system'];
      $b = body_json();
      $t = (string)($b['type'] ?? '');
      if ($t === 'irrigation_done') {
        db()->prepare(
          'INSERT INTO irrigation_history (system, d, liters, freq) VALUES (?, CURDATE(), ?, 1)
           ON DUPLICATE KEY UPDATE liters = liters + VALUES(liters), freq = freq + 1'
        )->execute([$sys, (float)($b['liters'] ?? 0)]);
      } elseif ($t === 'dose_done') {
        db()->prepare('INSERT INTO dose_history (system, a_l, b_l, ec) VALUES (?, ?, ?, ?)')
          ->execute([$sys, (float)($b['a'] ?? 0), (float)($b['b'] ?? 0), isset($b['ec']) ? (float)$b['ec'] : null]);
      } else {
        json_err(400, "Tipe event tidak dikenal: $t");
      }
      json_ok();
    }

    /* ================= ADMIN (khusus owner) ================= */
    case 'GET admin/fleet': {
      require_owner();
      $limit = (int) cfg_val('device_offline_after_s');
      $rows = db()->query('SELECT id, system, role, name, last_seen FROM devices ORDER BY system, role')->fetchAll();
      $fleet = array_map(function ($r) use ($limit) {
        $online = $r['last_seen'] !== null && (time() - strtotime($r['last_seen'])) <= $limit;
        return [
          'id' => $r['id'], 'system' => $r['system'], 'role' => $r['role'], 'name' => $r['name'],
          'online' => $online,
          'last_seen' => $r['last_seen'],
          'ago_s' => $r['last_seen'] !== null ? time() - strtotime($r['last_seen']) : null,
        ];
      }, $rows);
      json_ok(['fleet' => $fleet, 'offline_after_s' => $limit]);
    }

    case 'GET admin/users': {
      require_owner();
      $rows = db()->query('SELECT id, username, role, created_at FROM users ORDER BY id')->fetchAll();
      json_ok(['users' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'username' => $r['username'], 'role' => $r['role'], 'created_at' => $r['created_at'],
      ], $rows)]);
    }

    case 'POST admin/users/create': {
      require_owner();
      $b = body_json();
      $u = trim((string)($b['username'] ?? ''));
      $p = (string)($b['password'] ?? '');
      $role = ($b['role'] ?? 'operator') === 'owner' ? 'owner' : 'operator';
      if (strlen($u) < 3) json_err(400, 'Username minimal 3 karakter');
      if (strlen($p) < 8) json_err(400, 'Password minimal 8 karakter');
      try {
        db()->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
          ->execute([$u, password_hash($p, PASSWORD_DEFAULT), $role]);
      } catch (PDOException $e) {
        json_err(409, 'Username sudah dipakai');
      }
      json_ok(['ok' => true]);
    }

    case 'POST admin/users/password': {
      $me = require_owner();
      $b = body_json();
      $id = (int)($b['id'] ?? 0);
      $p = (string)($b['password'] ?? '');
      if (strlen($p) < 8) json_err(400, 'Password minimal 8 karakter');
      db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($p, PASSWORD_DEFAULT), $id]);
      json_ok(['ok' => true]);
    }

    case 'POST admin/users/delete': {
      $me = require_owner();
      $b = body_json();
      $id = (int)($b['id'] ?? 0);
      if ($id === (int)$me['id']) json_err(400, 'Tidak bisa menghapus akun sendiri');
      // Jangan sampai owner terakhir terhapus
      $owners = (int) db()->query("SELECT COUNT(*) c FROM users WHERE role='owner'")->fetch()['c'];
      $target = db()->prepare('SELECT role FROM users WHERE id = ?');
      $target->execute([$id]);
      $trow = $target->fetch();
      if ($trow && $trow['role'] === 'owner' && $owners <= 1) json_err(400, 'Tidak bisa menghapus owner terakhir');
      db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
      json_ok(['ok' => true]);
    }

    case 'GET admin/config': {
      require_owner();
      json_ok(['config' => [
        'telemetry_retention_days' => (int) cfg_val('telemetry_retention_days'),
        'device_offline_after_s' => (int) cfg_val('device_offline_after_s'),
      ]]);
    }

    case 'POST admin/config': {
      require_owner();
      $b = body_json();
      // Config yang boleh diubah dari UI disimpan di app_config (override file)
      $allowed = ['telemetry_retention_days', 'device_offline_after_s'];
      $saved = [];
      foreach ($allowed as $k) {
        if (isset($b[$k])) {
          $v = max(1, (int)$b[$k]);
          set_config_val("override:$k", $v);
          $saved[$k] = $v;
        }
      }
      json_ok(['ok' => true, 'saved' => $saved]);
    }

    // OTA — FONDASI SAJA. Firmware belum OTA-ready; endpoint ini
    // mencatat metadata .bin, belum mem-push ke device.
    case 'GET admin/ota': {
      require_owner();
      json_ok([
        'enabled' => false,
        'note' => 'OTA belum aktif: firmware perlu rutin OTA-pull dulu (ditambahkan setelah bench test).',
        'firmwares' => get_config_val('ota:firmwares', []),
      ]);
    }

    // Device menarik config kalibrasi/threshold (Kategori A).
    case 'GET device/config': {
      $dev = require_device();
      $localVer = (int)($_GET['ver'] ?? 0);
      $cfg = get_config_val("devcfg:{$dev['id']}", null);
      $ver = (int) get_config_val("devcfgver:{$dev['id']}", 0);
      if ($cfg === null || $ver <= $localVer) {
        json_ok(['changed' => false, 'version' => $ver]);
      }
      json_ok(['changed' => true, 'version' => $ver, 'config' => $cfg]);
    }

    case 'GET admin/device-config': {
      require_owner();
      $id = $_GET['device'] ?? '';
      if ($id === '') json_err(400, 'device wajib');
      json_ok([
        'config' => get_config_val("devcfg:$id", null),
        'version' => (int) get_config_val("devcfgver:$id", 0),
      ]);
    }

    case 'POST admin/device-config': {
      require_owner();
      $b = body_json();
      $id = (string)($b['device'] ?? '');
      if ($id === '') json_err(400, 'device wajib');
      // Hanya field Kategori A, validasi range aman di server.
      $allow = [
        'pScale' => [1.0, 500.0],
        'pOffset' => [-50.0, 50.0],
        'rawPPL' => [10.0, 5000.0],
        'totalIrrPoints' => [1, 200000],
        'pMin' => [0.0, 100.0],
        'pMax' => [1.0, 300.0],
        'dryrunMs' => [2000, 60000],
        'stallMs' => [2000, 60000],
        'doseMaxMs' => [10000, 600000],
      ];
      $cfg = [];
      foreach ($allow as $k => $r) {
        if (isset($b[$k]) && is_numeric($b[$k])) {
          $v = $b[$k] + 0;
          if ($v < $r[0]) $v = $r[0];
          if ($v > $r[1]) $v = $r[1];
          $cfg[$k] = ($k === 'totalIrrPoints' || $k === 'dryrunMs' || $k === 'stallMs' || $k === 'doseMaxMs') ? (int)$v : (float)$v;
        }
      }
      if (isset($cfg['pMin'], $cfg['pMax']) && $cfg['pMax'] <= $cfg['pMin']) {
        $cfg['pMax'] = $cfg['pMin'] + 1.0;
      }
      $ver = (int) get_config_val("devcfgver:$id", 0) + 1;
      set_config_val("devcfg:$id", $cfg);
      set_config_val("devcfgver:$id", $ver);
      json_ok(['ok' => true, 'version' => $ver, 'config' => $cfg]);
    }

    default:
      json_err(404, "Endpoint tidak ditemukan: $method /$route");
  }
} catch (PDOException $e) {
  error_log('KJ-API DB: ' . $e->getMessage());
  json_err(500, 'Kesalahan database');
} catch (Throwable $e) {
  error_log('KJ-API: ' . $e->getMessage());
  json_err(500, 'Kesalahan server');
}
