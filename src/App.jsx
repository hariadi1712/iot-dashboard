import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   KEBUN JAYA — Panel Irigasi (React port)
   Arsitektur sesuai PRD §3 & §5:
   - LIVE=false : mock ticker (simulasi, tanpa backend)
   - LIVE=true  : short-poll GET /api/state tiap POLL_MS,
                  semua aksi -> POST /api/command (queue, di-ack device)
   ============================================================ */
const LIVE = true;              // false = mode simulasi tanpa backend
const API_BASE = "/api";        // relatif — same-origin, bebas masalah CORS
const POLL_MS = 5000;

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const SYS_TEMPLATE = {
  tankL: 742, tankCap: 1100, psi: 8.4,
  distLit: 0, distActive: false, distTarget: 0,
  pumpDist: false, valveOpen: false, valveMoving: 0, pumpRAW: false, pumpOF2: true,
  pumpDoseA: false, pumpDoseB: false,
  alarmA: false, alarmB: false, estopActive: false, cleaning: false,
  floatRAW: false, floatGH: false, floatOF2: false, estop: false,
  todayL: 328, todayFreq: 3, yesterdayL: 470, yesterdayFreq: 4, perPoint: 2.73, totalIrrPoints: 1,
  doseTankA: 18.4, doseTankB: 12.1, doseCapA: 25, doseCapB: 25,
  ecMeasured: 1.96, tdsMeasured: 980, ecTemp: 27.4, ecSensorOK: true, ecInstalled: !LIVE, ecRaw: 0.31,
  usOK: true, usLastCm: 44.2, pressOK: true, flowOK: true, flowLpm: 0,
  floatOF2OK: true, floatRAWSynced: true, floatRAWAgeS: 12,
  ctrlOnline: true, doserOnline: true, online: true,
  rssi: -61, heapKb: 176, uptimeH: 37.4, schedVer: 7,
  status: "READY", hasRecharge: false,
  schedules: [],
  konsA: 10, konsB: 10, refEC: 2.0, targetEC: 2.0,
  autoDose: true, useRawSensor: true, ratioLock: false,
  rawWaterSeen: 0, autoDoseMlToday: 0, autoDoseDailyMaxMl: 5000,
  systemEnabled: true,  // Mode Aksi controller: true=ON, false=OFF (blokir jadwal+irigasi manual)
  doserSystemEnabled: true,  // Mode Aksi SmartDosing: true=ON, false=OFF (blokir dosing)
};

// Dua sistem kembar. GH tanpa recharge sumur bor; OF2 dengan recharge.
const INITIAL_SYSTEMS = {
  gh: {
    ...SYS_TEMPLATE, hasRecharge: false, tankL: 742,
    pumpChargeGH: false, rechargeMode: 0, of1Installed: false,
    schedules: [{ id: 1, time: "06:00", liters: 120, days: [1, 2, 3, 4, 5], enabled: true }],
  },
  of2: {
    ...SYS_TEMPLATE, hasRecharge: true, tankL: 610, pumpRAW: false, pumpOF2: true,
    schedules: [{ id: 2, time: "16:30", liters: 100, days: [1, 3, 5], enabled: true }],
  },
};

const SYS_LABEL = { gh: "Greenhouse", of2: "OF2 / Sumur Bor" };

// Data demo — dipakai hanya saat LIVE=false. Saat LIVE, server mengisi
// S.history & S.doseHistory dari MySQL lewat GET /api/state.
const MOCK_HISTORY = [
  { d: "03/07", day: "Jum", l: 470, f: 4 }, { d: "04/07", day: "Sab", l: 0, f: 0 },
  { d: "05/07", day: "Min", l: 328, f: 3 }, { d: "06/07", day: "Sen", l: 412, f: 4 },
  { d: "07/07", day: "Sel", l: 380, f: 3 }, { d: "08/07", day: "Rab", l: 455, f: 4 },
  { d: "09/07", day: "Kam", l: 390, f: 3 },
];
const MOCK_DOSE_HISTORY = [
  { d: "07/07", a: 2.5, b: 1.8, ec: 1.94 },
  { d: "08/07", a: 2.5, b: 2.0, ec: 2.02 },
  { d: "09/07", a: 3.0, b: 1.8, ec: 1.97 },
];

/* ============================================================
   API LAYER — satu titik ganti mock -> live
   ============================================================ */
const api = {
  async getState() {
    const r = await fetch(`${API_BASE}/state`, { credentials: "include" });
    if (!r.ok) throw new Error("state " + r.status);
    return r.json();
  },
  async sendCommand(system, type, payload = {}) {
    const r = await fetch(`${API_BASE}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ system, type, payload }),
    });
    if (!r.ok) throw new Error("command " + r.status);
    return r.json();
  },
  async saveSchedules(system, schedules) {
    const r = await fetch(`${API_BASE}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ system, schedules }),
    });
    if (!r.ok) throw new Error("schedules " + r.status);
    return r.json();
  },
};

/* ============================================================
   PERHITUNGAN DOSING (identik dengan logic firmware/backend)
   ============================================================ */
function doseCalc(S) {
  // Kompensasi air baku hanya kalau sensor EC terpasang; kalau belum,
  // dosis murni target/refEC (volume + k-factor).
  const ecOk = S.ecInstalled !== false;
  const rawEC = (ecOk && S.useRawSensor) ? S.ecRaw : 0;
  const effEC = Math.max(0, S.targetEC - rawEC);
  const scale = S.refEC > 0 ? effEC / S.refEC : 0;
  return { mlA: S.konsA * scale, mlB: S.konsB * scale, effEC, rawEC };
}
function doseFor(S, L) {
  const c = doseCalc(S);
  return { a: (L * c.mlA) / 1000, b: (L * c.mlB) / 1000 };
}

/* ============================================================
   CSS — aesthetic asli dipertahankan
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Chivo+Mono:wght@400;700&display=swap');
:root{
  --bg:#0E1B19; --panel:#132824; --raise:#17302B; --line:#1E3A34;
  --text:#D7E5E0; --dim:#7FA39A;
  --water:#53C8E8; --amber:#F2B84B; --danger:#E4604E; --run:#61D095;
  --doseA:#B08CE8; --doseB:#61D095; --ec:#E8C79A;
}
.kj *{box-sizing:border-box}
.kj{min-height:100vh;background:var(--bg);color:var(--text);font-family:'Archivo',system-ui,sans-serif;padding-bottom:92px}
.kj .mono{font-family:'Chivo Mono',monospace}
@media (prefers-reduced-motion: reduce){ .kj *{animation:none!important;transition:none!important} }
.kj input::placeholder{color:var(--dim);opacity:.6}
.kj input[type=time]{color-scheme:dark}
.kj header{padding:13px 16px;display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:20}
.kj .menu-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:40}
.kj .menu-panel{position:fixed;top:0;right:0;bottom:0;width:280px;background:var(--panel);border-left:1px solid var(--line);z-index:50;transform:translateX(100%);transition:transform .3s}
.kj .menu-panel.open{transform:translateX(0)}
.kj .menu-header{padding:16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
.kj .menu-title{font-weight:700;font-size:15px}
.kj .menu-section{margin:8px 0}
.kj .menu-section-title{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);padding:8px 16px 4px}
.kj .menu-item{display:flex;align-items:center;gap:12px;padding:12px 16px;color:var(--text);cursor:pointer;font-size:14px;text-decoration:none}
.kj .menu-item:hover{background:var(--raise)}
.kj .menu-item svg{width:20px;height:20px;flex-shrink:0;color:var(--dim)}
.kj .menu-divider{height:1px;background:var(--line);margin:8px 0}
.kj .sysbar{display:flex;gap:0;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:63px;z-index:19}
.kj .sysbtn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 8px;border:none;background:transparent;color:var(--dim);font-family:'Archivo',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent}
.kj .sysbtn.active{color:var(--text);border-bottom-color:var(--water);font-weight:800}
.kj .sysdot{width:8px;height:8px;border-radius:99px;flex-shrink:0}
.kj .sysflag{font-family:'Chivo Mono',monospace;font-size:8.5px;font-weight:700;color:var(--danger);border:1px solid var(--danger);border-radius:5px;padding:1px 5px;letter-spacing:.05em}
.kj .logo{width:36px;height:36px;border-radius:9px;background:var(--raise);border:1px solid rgba(83,200,232,.35);display:grid;place-items:center;font-weight:800;font-size:14px;color:var(--water)}
.kj .hname{font-weight:700;font-size:14.5px}
.kj .hsub{font-size:10.5px;color:var(--dim)}
.kj .sbadge{font-size:11px;font-weight:700;padding:5px 10px;border-radius:7px;color:var(--dim);border:1px solid var(--line)}
.kj .sbadge.run{color:var(--run);border-color:var(--run);background:rgba(97,208,149,.08)}
.kj .sbadge.estop{color:var(--danger);border-color:var(--danger);background:rgba(228,96,78,.10)}
.kj main{padding:14px;display:grid;gap:12px;max-width:560px;margin:0 auto}
.kj .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.kj .ptitle{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.kj .ptitle h2{margin:0;font-size:10.5px;letter-spacing:.14em;color:var(--dim);font-weight:700}
.kj .psub{font-size:9.5px;color:var(--dim)}
.kj .annun{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.kj .acell{padding:8px 2px;border-radius:8px;text-align:center;background:var(--panel);border:1px solid var(--line);color:var(--dim);font-size:9.5px;font-weight:700;letter-spacing:.06em;transition:all .3s}
.kj .acell .dot{display:block;width:6px;height:6px;border-radius:99px;margin:0 auto 5px;background:var(--line)}
.kj .acell.on{background:rgba(97,208,149,.12);border-color:var(--c);color:var(--c);box-shadow:0 0 12px rgba(97,208,149,.2)}
.kj .acell.on .dot{background:var(--c)}
.kj .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.kj .big{font-size:30px;font-weight:700;line-height:1}
.kj .big small{font-size:12px;color:var(--dim);font-weight:400}
.kj .bar{height:5px;background:var(--raise);border-radius:99px;margin-top:10px;overflow:hidden}
.kj .bar>div{height:100%;background:var(--water);transition:width 1s}
.kj .bar.low>div{background:var(--danger)}
.kj .tbl{display:grid;gap:0 14px;font-size:12px}
.kj .tbl .th{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);font-weight:700;padding-bottom:6px}
.kj .tbl .td{padding:8px 0;border-top:1px solid var(--line)}
.kj .r{text-align:right}
.kj input,.kj select{width:100%;padding:12px 13px;border-radius:10px;border:1px solid var(--line);background:var(--raise);color:var(--text);font-size:16px;outline:none;font-family:'Chivo Mono',monospace}
.kj input:disabled{background:var(--bg);opacity:.6}
.kj .btn{padding:12px 20px;border-radius:10px;border:none;cursor:pointer;background:var(--water);color:#0A1614;font-weight:800;font-size:13.5px;font-family:'Archivo',sans-serif}
.kj .btn:disabled{background:var(--line);cursor:not-allowed}
.kj .btn.danger{background:var(--danger);color:#fff}
.kj .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--text);font-weight:600}
.kj .btn.outline-danger{width:100%;padding:15px;background:transparent;border:2px solid var(--danger);color:var(--danger);letter-spacing:.06em;font-family:'Chivo Mono',monospace}
.kj .flex{display:flex;gap:9px}
.kj .flex1{flex:1}
.kj .lbl{font-size:10px;font-weight:700;color:var(--dim);margin-bottom:5px;letter-spacing:.05em}
.kj .tgl{width:50px;height:28px;border-radius:99px;border:1px solid var(--line);cursor:pointer;background:var(--raise);position:relative;transition:all .2s;flex-shrink:0;padding:0}
.kj .tgl::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:99px;background:var(--dim);transition:left .2s}
.kj .tgl.on{border-color:var(--water);background:rgba(83,200,232,.2)}
.kj .tgl.on::after{left:25px;background:var(--water)}
.kj .tgl:disabled{opacity:.45;cursor:not-allowed}
.kj .tgl.sm{width:43px;height:24px}
.kj .tgl.sm::after{width:17px;height:17px}
.kj .tgl.sm.on::after{left:22px}
.kj .rowitem{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}
.kj .rowitem:last-child{border-bottom:none}
.kj .sdot{width:7px;height:7px;border-radius:99px;flex-shrink:0;background:var(--line)}
.kj .sdot.ok{background:var(--run)} .kj .sdot.warn{background:var(--amber)}
.kj .sdot.fault{background:var(--danger);box-shadow:0 0 8px var(--danger)}
.kj .pill{font-size:10px;font-weight:700;padding:4px 9px;border-radius:7px;white-space:nowrap;font-family:'Chivo Mono',monospace;border:1px solid var(--dim);color:var(--dim)}
.kj .pill.ok{color:var(--run);border-color:var(--run);background:rgba(97,208,149,.08)}
.kj .pill.warn{color:var(--amber);border-color:var(--amber);background:rgba(242,184,75,.08)}
.kj .pill.fault{color:var(--danger);border-color:var(--danger);background:rgba(228,96,78,.08)}
.kj .daybtn{padding:8px 0;width:40px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--dim);font-family:'Archivo'}
.kj .daybtn.sel{border-color:var(--water);background:rgba(83,200,232,.15);color:var(--water)}
.kj nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--panel);border-top:1px solid var(--line);z-index:30}
.kj nav button{flex:1;padding:13px 0 15px;border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:500;color:var(--dim);border-top:2px solid transparent;margin-top:-1px;font-family:'Archivo',sans-serif}
.kj nav button.active{color:var(--water);border-top-color:var(--water);font-weight:800}
.kj .toast{position:fixed;bottom:82px;left:50%;transform:translateX(-50%);background:var(--raise);border:1px solid var(--line);color:var(--text);padding:10px 16px;border-radius:10px;font-size:13px;max-width:88%;z-index:60;opacity:0;pointer-events:none;transition:opacity .25s}
.kj .toast.show{opacity:1}
.kj .note{font-size:10.5px;color:var(--dim);line-height:1.6}
.kj .warnnote{font-size:11.5px;color:var(--amber);font-weight:600;margin-top:10px}
.kj .raisebox{padding:11px 13px;background:var(--raise);border-radius:10px;font-size:12.5px;line-height:1.9}
`;

/* ============================================================
   SUB-KOMPONEN
   ============================================================ */
function FlowDots({ path, color, n, dur }) {
  return Array.from({ length: n }, (_, i) => (
    <circle key={i} r="3.2" fill={color}>
      <animateMotion dur={`${dur}s`} begin={`${((i * dur) / n).toFixed(2)}s`} repeatCount="indefinite" path={path} />
    </circle>
  ));
}

function Pump({ x, y, on, label }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r="14" fill="#17302B" stroke={on ? "#61D095" : "#1E3A34"} strokeWidth="2" />
      <path d="M -5 -6 L 7 0 L -5 6 Z" fill={on ? "#61D095" : "#7FA39A"}>
        {on && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s" repeatCount="indefinite" />}
      </path>
      <text y="28" textAnchor="middle" fill={on ? "#61D095" : "#7FA39A"} fontSize="8.5" fontFamily="Chivo Mono" fontWeight="700">{label}</text>
    </g>
  );
}

function Schematic({ S, sys, offline }) {
  const line = "#1E3A34", dim = "#7FA39A", water = "#53C8E8", run = "#61D095",
    panel = "#132824", amber = "#F2B84B", doseA = "#B08CE8", doseB = "#61D095",
    danger = "#E4604E", ec = "#E8C79A", text = "#D7E5E0", pending = "#4A5D57";
  const pct = Math.max(0, Math.min(1, S.tankL / S.tankCap));
  const tankW = 84, tankH = 78;
  const fillH = pct * tankH;
  // Pompa air baku pengisi tandon (GH: charge GH; OF2: pompa OF2). Trigger mixer.
  const fillOn = !offline && (sys === "of2" ? (S.pumpOF2 || S.pumpRAW) : S.pumpChargeGH);
  const doseOn = !offline && (S.pumpDoseA || S.pumpDoseB);
  const outOn = !offline && S.pumpDist && S.valveOpen;
  const mixerOn = fillOn || doseOn; // mixer ikut pengisian air baku / dosing
  // Belum terpasang (hardware fisik belum ada): flow air baku & mixer
  const rawFlowInstalled = false;
  const mixerInstalled = false;
  const ecDev = Math.abs(S.ecMeasured - S.targetEC);
  const ecCol = S.ecInstalled === false ? pending : !S.ecSensorOK ? danger : ecDev > 0.3 ? amber : ec;

  // Geometri
  const tankX = 120, tankY = 52;
  const pIntake = `M 24 150 H 76`;                    // sumber -> pompa air baku
  const pFill   = `M 92 150 H 120 V ${tankY + tankH}`; // pompa -> masuk tandon (bawah)
  const pOut    = `M ${tankX + tankW} ${tankY + tankH - 14} H 250 H 300`; // tandon -> valve -> pompa dist
  const pField  = `M 300 ${tankY + tankH - 14} H 348`;
  const dripA   = `M ${tankX + 22} ${tankY - 16} V ${tankY + 4}`;
  const dripB   = `M ${tankX + tankW - 22} ${tankY - 16} V ${tankY + 4}`;

  return (
    <svg viewBox="0 0 372 200" width="100%" aria-label="Skema sistem air (batch mixing)">
      {/* SUMBER air baku */}
      <text x="24" y="176" textAnchor="middle" fill={dim} fontSize="8.5" fontFamily="Chivo Mono">SUMBER</text>
      <rect x="10" y="142" width="28" height="16" rx="3" fill="none" stroke={dim} strokeWidth="1.5" />
      <path d="M 14 150 q 5 -4 10 0 t 10 0" stroke={water} strokeWidth="1.5" fill="none" />

      {/* Jalur intake -> pompa air baku */}
      <path d={pIntake} stroke={fillOn ? water : line} strokeWidth="5" fill="none" strokeLinecap="round" />
      {fillOn && <FlowDots path={pIntake} color={water} n={2} dur={2.0} />}
      <Pump x={84} y={150} on={fillOn} label={sys === "of2" ? "P-OF2" : "P-CHG"} />

      {/* Flow sensor air baku (BELUM TERPASANG) di jalur masuk tandon */}
      <g transform="translate(108,150)" opacity={rawFlowInstalled ? 1 : 0.5}>
        <circle r="9" fill="#17302B" stroke={rawFlowInstalled ? water : pending} strokeWidth="1.5" strokeDasharray={rawFlowInstalled ? "0" : "2 2"} />
        <text y="2.5" textAnchor="middle" fill={rawFlowInstalled ? water : pending} fontSize="6.5" fontFamily="Chivo Mono" fontWeight="700">FL</text>
        {!rawFlowInstalled && <text y="20" textAnchor="middle" fill={pending} fontSize="6" fontFamily="Chivo Mono">N/A</text>}
      </g>

      {/* Jalur masuk tandon */}
      <path d={pFill} stroke={fillOn ? water : line} strokeWidth="5" fill="none" strokeLinecap="round" />
      {fillOn && <FlowDots path={pFill} color={water} n={2} dur={2.2} />}

      {/* Botol nutrisi A & B menetes KE DALAM tandon (batch) */}
      <g transform={`translate(${tankX + 14},${tankY - 30})`}>
        <rect x="-7" y="-8" width="16" height="16" rx="3" fill={panel} stroke={S.pumpDoseA && !offline ? doseA : line} strokeWidth="1.5" />
        <text y="3" textAnchor="middle" fill={S.pumpDoseA && !offline ? doseA : dim} fontSize="8" fontFamily="Chivo Mono" fontWeight="700">A</text>
      </g>
      <g transform={`translate(${tankX + tankW - 14},${tankY - 30})`}>
        <rect x="-7" y="-8" width="16" height="16" rx="3" fill={panel} stroke={S.pumpDoseB && !offline ? doseB : line} strokeWidth="1.5" />
        <text y="3" textAnchor="middle" fill={S.pumpDoseB && !offline ? doseB : dim} fontSize="8" fontFamily="Chivo Mono" fontWeight="700">B</text>
      </g>
      <path d={dripA} stroke={S.pumpDoseA && !offline ? doseA : line} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="2 3" />
      <path d={dripB} stroke={S.pumpDoseB && !offline ? doseB : line} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="2 3" />
      {S.pumpDoseA && !offline && <FlowDots path={dripA} color={doseA} n={2} dur={1.0} />}
      {S.pumpDoseB && !offline && <FlowDots path={dripB} color={doseB} n={2} dur={1.0} />}

      {/* TANDON dengan air ter-mix */}
      <g transform={`translate(${tankX},${tankY})`}>
        <rect width={tankW} height={tankH + 10} rx="8" fill={panel} stroke={line} strokeWidth="2" />
        <clipPath id="tkh"><rect x="3" y="3" width={tankW - 6} height={tankH + 4} rx="6" /></clipPath>
        <g clipPath="url(#tkh)">
          <rect x="3" y={3 + (tankH + 4) - fillH} width={tankW - 6} height={fillH} fill={water} opacity="0.7" />
        </g>
        {/* Mixer (BELUM TERPASANG): batang + baling di tengah tandon */}
        <g transform={`translate(${tankW / 2},14)`} opacity={mixerInstalled ? 1 : 0.5}>
          <line y2={tankH - 26} stroke={mixerInstalled ? (mixerOn ? run : dim) : pending} strokeWidth="2" strokeDasharray={mixerInstalled ? "0" : "3 2"} />
          <g transform={`translate(0,${tankH - 26})`}>
            <line x1="-9" y1="0" x2="9" y2="0" stroke={mixerInstalled ? (mixerOn ? run : dim) : pending} strokeWidth="2.5">
              {mixerInstalled && mixerOn && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite" />}
            </line>
          </g>
        </g>
        <text x={tankW / 2} y={tankH / 2 + 2} textAnchor="middle" fill={text} fontSize="15" fontWeight="700" fontFamily="Chivo Mono">{offline ? "—" : Math.round(pct * 100) + "%"}</text>
        <text x={tankW / 2} y={tankH + 26} textAnchor="middle" fill={dim} fontSize="8.5" fontFamily="Chivo Mono">{`TANDON ${(sys || "").toUpperCase()}`}</text>
        <circle cx={tankW - 8} cy="8" r="3.5" fill={(sys === "of2" ? S.floatOF2 : S.floatGH) && !offline ? amber : line} />
      </g>
      {/* Label mixer belum terpasang */}
      {!mixerInstalled && (
        <text x={tankX + tankW / 2} y={tankY - 2} textAnchor="middle" fill={pending} fontSize="6.5" fontFamily="Chivo Mono">MIXER N/A</text>
      )}

      {/* Keluaran tandon -> valve -> pompa distribusi -> lahan (TANPA injeksi inline) */}
      <path d={pOut} stroke={outOn ? water : line} strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d={pField} stroke={outOn ? water : line} strokeWidth="5" fill="none" strokeLinecap="round" />
      {outOn && <><FlowDots path={pOut} color={water} n={3} dur={2.2} /><FlowDots path={pField} color={water} n={2} dur={1.4} /></>}

      {/* Valve */}
      <g transform={`translate(250,${tankY + tankH - 14})`}>
        <path d="M -11 -8 L 0 0 L -11 8 Z M 11 -8 L 0 0 L 11 8 Z" fill={S.valveOpen && !offline ? water : "none"} stroke={S.valveOpen && !offline ? water : dim} strokeWidth="2" strokeLinejoin="round" />
        <line y2="-13" stroke={S.valveOpen && !offline ? water : dim} strokeWidth="2" />
        <circle cy="-16" r="3.5" fill="none" stroke={S.valveOpen && !offline ? water : dim} strokeWidth="2" />
        <text y="26" textAnchor="middle" fill={S.valveOpen && !offline ? water : dim} fontSize="8" fontFamily="Chivo Mono" fontWeight="700">{offline ? "—" : S.valveOpen ? "BUKA" : "TUTUP"}</text>
      </g>
      <Pump x={300} y={tankY + tankH - 14} on={!offline && S.pumpDist} label="P-DIST" />

      {/* LAHAN */}
      <g transform={`translate(340,${tankY + tankH - 28})`}>
        <path d="M 4 28 q 4 -10 8 0 M 12 28 q 4 -14 8 0" stroke={outOn ? run : dim} strokeWidth="2" fill="none" />
        <text x="12" y="44" textAnchor="middle" fill={dim} fontSize="8.5" fontFamily="Chivo Mono">LAHAN</text>
      </g>
    </svg>
  );
}

function Gauge({ psi }) {
  const min = 0, max = 20, lo = 5, hi = 16;
  const p = Math.max(min, Math.min(max, psi));
  const a = (v) => ((-210 + ((v - min) / (max - min)) * 240) * Math.PI) / 180;
  const arc = (v1, v2, r) => {
    const p1 = [60 + r * Math.cos(a(v1)), 62 + r * Math.sin(a(v1))];
    const p2 = [60 + r * Math.cos(a(v2)), 62 + r * Math.sin(a(v2))];
    return `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A ${r} ${r} 0 ${v2 - v1 > 15 ? 1 : 0} 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  };
  const warn = psi < lo || psi > hi;
  const n = a(p);
  const col = warn ? "#F2B84B" : "#53C8E8";
  return (
    <svg viewBox="0 0 120 100" width="100%">
      <path d={arc(min, max, 44)} stroke="#1E3A34" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d={arc(lo, hi, 44)} stroke="rgba(97,208,149,.4)" strokeWidth="7" fill="none" strokeLinecap="round" />
      <line x1="60" y1="62" x2={(60 + 34 * Math.cos(n)).toFixed(1)} y2={(62 + 34 * Math.sin(n)).toFixed(1)} stroke={col} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="60" cy="62" r="4" fill={col} />
      <text x="60" y="88" textAnchor="middle" fill={warn ? "#F2B84B" : "#D7E5E0"} fontSize="17" fontWeight="700" fontFamily="Chivo Mono">{psi.toFixed(1)}</text>
      <text x="60" y="98" textAnchor="middle" fill="#7FA39A" fontSize="7.5" fontFamily="Chivo Mono">PSI · 5–16</text>
    </svg>
  );
}

function StatusRow({ name, detail, state, text, last }) {
  return (
    <div className="rowitem">
      <span className={`sdot ${state === "off" ? "" : state}`} />
      <div className="flex1" style={{ minWidth: 0 }}>
        <div style={{ fontSize: "13.5px" }}>{name}</div>
        <div className="note mono" style={{ fontSize: "10.5px" }}>{detail}</div>
      </div>
      {last && <div className="mono" style={{ fontSize: "11.5px", textAlign: "right" }}>{last}</div>}
      <span className={`pill ${state === "off" ? "" : state}`}>{text}</span>
    </div>
  );
}

/* ============================================================
   KOMPONEN UTAMA
   ============================================================ */
export default function KebunJayaDashboard() {
  const [systems, setSystems] = useState(INITIAL_SYSTEMS);
  const [sys, setSys] = useState("gh"); // sistem aktif: 'gh' | 'of2'
  const [tab, setTab] = useState("monitor");
  const [toast, setToast] = useState("");
  const [estopArm, setEstopArm] = useState(false);
  const [schedFormOpen, setSchedFormOpen] = useState(false);
  const [nsTime, setNsTime] = useState("06:00");

  // S = slice sistem aktif; setS menulis balik ke sistem aktif saja
  const S = systems[sys];
  const setS = useCallback((updater) => {
    setSystems((all) => ({
      ...all,
      [sys]: typeof updater === "function" ? updater(all[sys]) : updater,
    }));
  }, [sys]);

  // ==== Kejujuran data (LIVE): device offline -> "—", sensor belum
  //      terpasang -> "N/A". Mock mode selalu dianggap online. ====
  const ctrlOff = LIVE && S.ctrlOnline === false;   // controller tidak kirim telemetry
  const ecMissing = LIVE && S.ecInstalled === false; // sensor EC belum terpasang
  // format angka: v = nilai, d = desimal; offline -> "—"
  const fnum = (v, d = 0) => ctrlOff || v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d);

  const [nsLiters, setNsLiters] = useState("");
  const [nsDays, setNsDays] = useState([1, 2, 3, 4, 5]);
  const [targetInput, setTargetInput] = useState("");
  const [doseAIn, setDoseAIn] = useState("");
  const [doseBIn, setDoseBIn] = useState("");
  const toastT = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(""), 3200);
  }, []);

  /* ---- Command dispatcher: mock = apply lokal; live = POST queue ---- */
  const cmd = useCallback(async (type, payload, applyLocal) => {
    if (LIVE) {
      try {
        await api.sendCommand(sys, type, payload);
      } catch {
        notify("Gagal mengirim perintah — cek koneksi.");
        return false;
      }
      if (applyLocal) setS((p) => applyLocal(p));
      return true;
    }
    if (applyLocal) setS((p) => applyLocal(p));
    return true;
  }, [notify, sys, setS]);

  /* ---- Auth ---- */
  const [auth, setAuth] = useState(LIVE ? "checking" : "ok"); // checking | login | ok
  const [loginU, setLoginU] = useState("");
  const [loginP, setLoginP] = useState("");
  const [loginErr, setLoginErr] = useState("");

  const doLogin = async () => {
    setLoginErr("");
    try {
      const r = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: loginU, password: loginP }),
      });
      if (!r.ok) { setLoginErr("Username atau password salah."); return; }
      setAuth("ok"); setLoginP("");
    } catch {
      setLoginErr("Tidak bisa terhubung ke server.");
    }
  };

  /* ---- LIVE: short-poll /api/state ---- */
  useEffect(() => {
    if (!LIVE || auth !== "ok" && auth !== "checking") return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/state`, { credentials: "include" });
        if (r.status === 401) { if (!stop) setAuth("login"); return; }
        if (!r.ok) throw new Error();
        const st = await r.json();
        if (!stop && st.systems) {
          setAuth("ok");
          setSystems((all) => ({
            gh:  { ...all.gh,  ...(st.systems.gh  || {}), hasRecharge: false },
            of2: { ...all.of2, ...(st.systems.of2 || {}), hasRecharge: true },
          }));
        }
      } catch {
        if (!stop) setSystems((all) => ({
          gh:  { ...all.gh,  online: false },
          of2: { ...all.of2, online: false },
        }));
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [auth]);

  /* ---- MOCK: ticker telemetri (kedua sistem) ---- */
  useEffect(() => {
    if (LIVE) return;
    const step = (p) => {
      const drift = p.pumpDist ? p.targetEC : p.ecMeasured;
      const ecM = Math.max(0.2, p.ecMeasured + (drift - p.ecMeasured) * 0.08 + (Math.random() - 0.5) * 0.03);
      return {
        ...p,
        tankL: Math.max(80, Math.min(p.tankCap, p.tankL + ((p.pumpOF2 || p.pumpChargeGH) ? 1.2 : 0) - (p.pumpDist ? 2.0 : 0.04) + (Math.random() - 0.5))),
        psi: Math.max(0, p.psi + (Math.random() - 0.5) * 0.22),
        ecMeasured: ecM,
        tdsMeasured: Math.round(Math.max(100, ecM * 500 + (Math.random() - 0.5) * 12)),
        ecTemp: p.ecTemp + (Math.random() - 0.5) * 0.1,
        flowLpm: p.pumpDist ? Math.max(0, 38 + (Math.random() - 0.5) * 6) : 0,
        rssi: Math.round(Math.max(-85, Math.min(-45, p.rssi + (Math.random() - 0.5) * 3))),
        uptimeH: p.uptimeH + 1.6 / 3600,
      };
    };
    const id = setInterval(() => {
      setSystems((all) => ({ gh: step(all.gh), of2: step(all.of2) }));
    }, 1600);
    return () => clearInterval(id);
  }, []);

  const history = S.history && S.history.length ? S.history : LIVE ? [] : MOCK_HISTORY;
  const doseHistory = S.doseHistory && S.doseHistory.length ? S.doseHistory : LIVE ? [] : MOCK_DOSE_HISTORY;
  const c = doseCalc(S);
  const dev = S.ecMeasured - S.targetEC;
  const devPct = S.targetEC > 0 ? (dev / S.targetEC) * 100 : 0;
  const ecState = !S.ecSensorOK ? "fault" : Math.abs(devPct) > 15 ? "warn" : "ok";
  const ecCol = ecState === "fault" ? "var(--danger)" : ecState === "warn" ? "var(--amber)" : "var(--ec)";
  const tankLow = S.tankL < 100;
  const maxL = Math.max(...history.map((h) => h.l), 1);
  const bw = 340 / history.length;
  const wt = history.reduce((s, h) => s + h.l, 0);
  const wf = history.reduce((s, h) => s + h.f, 0);
  const psiWarn = S.psi < 5 || S.psi > 16;
  const rssiState = S.rssi > -67 ? "ok" : S.rssi > -75 ? "warn" : "fault";
  const anySchedOn = S.schedules.some((s) => s.enabled);

  /* ---- Handlers ---- */
  const doIrrigate = () => {
    const v = parseFloat(targetInput);
    if (!v || v <= 0) return notify("Masukkan target liter yang valid.");
    if (tankLow) return notify("Tangki di bawah 100 L — irigasi diblokir.");
    cmd("irrigate", { liters: v }, (p) => ({
      ...p,
      pumpDist: true, valveOpen: true,
      status: "DISTRIB: RUN",
    }));
    notify(`Target ${v} L terkirim ke ${SYS_LABEL[sys]}.`);
    setTargetInput("");
  };

  const tglValve = () =>
    cmd("valve", { open: !S.valveOpen }, (p) => {
      const open = !p.valveOpen;
      notifyLater(`Valve motorized: ${open ? "MEMBUKA (18 dtk)" : "MENUTUP (18 dtk)"}`);
      return { ...p, valveOpen: open, pumpDist: open ? p.pumpDist : false };
    });
  const tglPump = () =>
    cmd("pump_dist", { on: !S.pumpDist }, (p) => {
      const on = !p.pumpDist;
      notifyLater(`Pompa distribusi: ${on ? "ON (valve auto-open)" : "OFF"}`);
      return { ...p, pumpDist: on, valveOpen: on ? true : p.valveOpen };
    });
  // notify di luar setState agar tidak double di StrictMode
  const notifyLater = (m) => setTimeout(() => notify(m), 0);

  const setRecharge = (v) => {
    if (sys === "gh") {
      // GH: hanya OFF (0) atau Charge GH (2). OF1 (1) & BOTH (3) belum terpasang.
      const mode = v === 2 ? 2 : 0;
      cmd("recharge", { mode }, (p) => ({ ...p, rechargeMode: mode, pumpChargeGH: mode === 2 }));
      notify(mode === 2 ? "Recharge tandon GH: ON (charge GH)" : "Recharge tandon GH: OFF");
      return;
    }
    // OF2: OFF / RAW / OF2 / Keduanya
    cmd("recharge", { mode: v }, (p) => ({ ...p, pumpRAW: v === 1 || v === 3, pumpOF2: v === 2 || v === 3 }));
    notify(`Mode recharge: ${["OFF", "RAW", "OF2", "Keduanya"][v]}`);
  };

  const fireEstop = () => {
    setEstopArm(false);
    cmd("estop", { active: true }, (p) => ({
      ...p, estop: true, pumpDist: false, valveOpen: false,
      pumpDoseA: false, pumpDoseB: false, status: "E-STOP AKTIF",
    }));
    notify("E-STOP aktif. Semua pompa berhenti, valve menutup.");
  };
  const releaseEstop = () => {
    cmd("estop", { active: false }, (p) => ({ ...p, estop: false, status: "READY" }));
    notify("E-STOP dilepas.");
  };

  const saveSchedule = () => {
    const v = parseFloat(nsLiters);
    if (!v || v <= 0) return notify("Masukkan liter yang valid.");
    if (!nsDays.length) return notify("Pilih minimal satu hari.");
    const next = [...S.schedules, { id: Date.now(), time: nsTime, liters: v, days: [...nsDays].sort(), enabled: true }];
    setS((p) => ({ ...p, schedules: next }));
    if (LIVE) api.saveSchedules(sys, next).catch(() => notify("Gagal sync jadwal ke server."));
    setSchedFormOpen(false); setNsLiters("");
    notify(`Jadwal ${nsTime} · ${v} L ditambahkan.`);
  };
  const toggleSchedule = (id) => {
    const next = S.schedules.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x));
    const s = next.find((x) => x.id === id);
    setS((p) => ({ ...p, schedules: next }));
    if (LIVE) api.saveSchedules(sys, next).catch(() => notify("Gagal sync jadwal ke server."));
    notify(`Jadwal ${s.time} ${s.enabled ? "diaktifkan" : "dinonaktifkan"}.`);
  };
  const deleteSchedule = (id) => {
    const s = S.schedules.find((x) => x.id === id);
    const next = S.schedules.filter((x) => x.id !== id);
    setS((p) => ({ ...p, schedules: next }));
    if (LIVE) api.saveSchedules(sys, next).catch(() => notify("Gagal sync jadwal ke server."));
    if (s) notify(`Jadwal ${s.time} dihapus.`);
  };

  const setFactor = () => {
    cmd("dose_config", {
      konsA: S.konsA, konsB: S.konsB, refEC: S.refEC, targetEC: S.targetEC,
      autoDose: S.autoDose, useRawSensor: S.useRawSensor,
    });
    notify(`Faktor tersimpan: A ${S.konsA}+B ${S.konsB} ml/L → EC ${S.refEC.toFixed(1)}. Target ${S.targetEC.toFixed(1)}.`);
  };

  // Toggle auto-dose air baku: kirim ke firmware Smartdosing (command 'autodose').
  const setAutoDose = (enabled) => {
    cmd("autodose", {
      enabled,
      konsA: S.konsA, konsB: S.konsB,
      dailyMaxMl: S.autoDoseDailyMaxMl ?? 5000,
    }, (p) => ({ ...p, autoDose: enabled }));
    notify(enabled
      ? `Auto-dose AKTIF: tiap 10 L air baku → inject A ${S.konsA}+B ${S.konsB} ml/L.`
      : "Auto-dose NONAKTIF. Dosing manual saja.");
  };

  // Cleaning dosing: ON 5s / OFF 5s × 10 (firmware yang jalankan siklus).
  const startCleaning = () => {
    cmd("clean", {}, (p) => ({ ...p, cleaning: true }));
    notify("Cleaning dosing dimulai: ON 5 dtk / OFF 5 dtk × 10.");
  };

  // Reset guard lock (toggle e-stop OFF membersihkan alarm).
  const resetGuardLock = () => {
    cmd("estop", { active: false }, (p) => ({ ...p, alarmA: false, alarmB: false, estopActive: false, status: "RESET" }));
    notify("Guard di-reset. Sistem dosing kembali normal.");
  };

  // Mode Aksi: toggle system ON/OFF
  const toggleSystem = () => {
    const newState = !S.systemEnabled;
    cmd("system_power", { enable: newState }, (p) => ({ ...p, systemEnabled: newState }));
    notify(newState ? "Mode Aksi: AKTIF — irigasi boleh berjalan." : "Mode Aksi: NONAKTIF — irigasi dijeda.");
  };

  // Restart controller
  const restartDevice = () => {
    cmd("restart", {});
    notify("Restart dikirim — ESP32 akan reboot...");
  };

  // Mode Aksi SmartDosing: toggle dosing system ON/OFF
  const toggleDoserSystem = () => {
    const newState = !S.doserSystemEnabled;
    cmd("system_power", { enable: newState }, (p) => ({ ...p, doserSystemEnabled: newState }));
    notify(newState ? "SmartDosing AKTIF — dosing boleh berjalan." : "SmartDosing NONAKTIF — dosing dijeda.");
  };

  // Restart SmartDosing
  const restartDoser = () => {
    cmd("restart", {});
    notify("Restart SmartDosing dikirim — ESP32 akan reboot...");
  };

  const sendDose = () => {
    const a = parseFloat(doseAIn) || 0, b = parseFloat(doseBIn) || 0;
    if (a <= 0 && b <= 0) return notify("Masukkan target dosing A dan/atau B.");
    if (a > S.doseTankA) return notify(`Stok A tidak cukup (${S.doseTankA.toFixed(1)} L).`);
    if (b > S.doseTankB) return notify(`Stok B tidak cukup (${S.doseTankB.toFixed(1)} L).`);
    if (!S.doserOnline) return notify("Unit dosing offline — perintah ditolak.");
    cmd("dose", { a, b }, (p) => ({ ...p, pumpDoseA: a > 0, pumpDoseB: b > 0 }));
    notify(`Dosing terkirim — A ${a} L, B ${b} L.`);
    setDoseAIn(""); setDoseBIn("");
  };

  const numField = (key) => (e) => setS((p) => ({ ...p, [key]: parseFloat(e.target.value) || 0 }));

  /* ============================================================ */
  if (LIVE && auth !== "ok") {
    return (
      <div className="kj">
        <style>{CSS}</style>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
          <div className="panel" style={{ width: "100%", maxWidth: 360 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
              <img src="/assets/logo.png" alt="P² LABS" style={{height:44,width:"auto"}} />
              <div>
                <div className="hname">P² LABS</div>
                <div className="hsub mono">Panel Irigasi</div>
              </div>
            </div>
            {auth === "checking" ? (
              <div className="note" style={{ textAlign: "center", padding: "12px 0" }}>Memeriksa sesi…</div>
            ) : (
              <div style={{ display: "grid", gap: 11 }}>
                <div><div className="lbl mono">USERNAME</div>
                  <input value={loginU} onChange={(e) => setLoginU(e.target.value)} autoCapitalize="none" /></div>
                <div><div className="lbl mono">PASSWORD</div>
                  <input type="password" value={loginP} onChange={(e) => setLoginP(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doLogin()} /></div>
                {loginErr && <div className="warnnote" style={{ color: "var(--danger)", margin: 0 }}>{loginErr}</div>}
                <button className="btn" onClick={doLogin}>Masuk</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kj">
      <style>{CSS}</style>

      <header>
        <img src="/assets/logo.png" alt="P² LABS" style={{height:38,width:"auto"}} />
        <div style={{ flex: 1 }}>
          <div className="hname">P² LABS · {SYS_LABEL[sys]}</div>
          <div className="hsub mono">iot.petanipizza.xyz{LIVE ? "" : " · MODE SIMULASI"}</div>
        </div>
        <div className={`sbadge mono ${S.estop ? "estop" : S.pumpDist ? "run" : ""}`}>{S.status}</div>
      {/* Pemilih sistem GH / OF2 */}
      </header>
      <div className="sysbar">
        {["gh", "of2"].map((k) => {
          const st = systems[k];
          const dotCol = st.estop ? "var(--danger)" : st.pumpDist ? "var(--run)" : st.online ? "var(--water)" : "var(--dim)";
          return (
            <button key={k} className={`sysbtn ${sys === k ? "active" : ""}`}
              onClick={() => { setSys(k); setEstopArm(false); setSchedFormOpen(false); }}>
              <span className="sysdot" style={{ background: dotCol }} />
              {SYS_LABEL[k]}
              {st.estop && <span className="sysflag">E-STOP</span>}
            </button>
          );
        })}
      </div>

      <main>
        {/* ==================== MONITOR ==================== */}
        {tab === "monitor" && (
          <div>
            <div className="annun" style={{ marginBottom: 12 }}>
              {(S.hasRecharge
                ? [
                    ["RUN", S.pumpDist, "#61D095"], ["VALVE", S.valveOpen, "#53C8E8"],
                    ["P-RAW", S.pumpRAW, "#61D095"], ["P-OF2", S.pumpOF2, "#61D095"],
                    ["DOSE", S.pumpDoseA || S.pumpDoseB, "#B08CE8"], ["EC", S.ecSensorOK, "#E8C79A"],
                    ["E-STOP", S.estop, "#E4604E"], ["KOM", S.online, "#61D095"],
                  ]
                : [
                    ["RUN", S.pumpDist, "#61D095"], ["VALVE", S.valveOpen, "#53C8E8"],
                    ["DOSE", S.pumpDoseA || S.pumpDoseB, "#B08CE8"], ["EC", S.ecSensorOK, "#E8C79A"],
                    ["E-STOP", S.estop, "#E4604E"], ["KOM", S.online, "#61D095"],
                  ]
              ).map(([l, on, col]) => (
                <div key={l} className={`acell mono ${on ? "on" : ""}`} style={{ "--c": col }}>
                  <span className="dot" />{l}
                </div>
              ))}
            </div>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">SKEMA SISTEM · {ctrlOff ? "OFFLINE" : "LIVE"}</h2>
                {ctrlOff && <span className="psub mono" style={{ color: "var(--dim)" }}>data tidak tersedia</span>}
              </div>
              <div style={{ opacity: ctrlOff ? 0.3 : 1, transition: "opacity .3s" }}>
                <Schematic S={S} sys={sys} offline={ctrlOff} />
              </div>
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle">
                <h2 className="mono">KUALITAS AIR · EC / TDS</h2>
                <span className="psub mono" style={{ color: ecMissing ? "var(--dim)" : ctrlOff ? "var(--dim)" : S.ecSensorOK ? "var(--run)" : "var(--danger)" }}>
                  {ecMissing ? "BELUM TERPASANG" : ctrlOff ? "OFFLINE" : S.ecSensorOK ? "MODBUS OK" : "SENSOR FAULT"}
                </span>
              </div>
              {ecMissing ? (
                <div className="raisebox" style={{ textAlign: "center", color: "var(--dim)" }}>
                  Sensor EC/TDS (Modbus RS485) belum terpasang.
                  Dosing tetap berjalan berbasis volume + k-factor.
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div><div className="big mono" style={{ fontSize: 26, color: ecCol }}>{ctrlOff || !S.ecSensorOK ? "—" : S.ecMeasured.toFixed(2)}</div><div className="note mono">EC mS/cm</div></div>
                    <div><div className="big mono" style={{ fontSize: 26 }}>{ctrlOff || !S.ecSensorOK ? "—" : S.tdsMeasured}</div><div className="note mono">TDS ppm</div></div>
                    <div><div className="big mono" style={{ fontSize: 26, color: "var(--dim)" }}>{fnum(S.ecTemp, 1)}°</div><div className="note mono">suhu air</div></div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--dim)", marginBottom: 5 }}>
                      <span>target {S.targetEC.toFixed(1)}</span>
                      <span style={{ color: ecState === "warn" ? "var(--amber)" : "var(--dim)" }}>deviasi {dev >= 0 ? "+" : ""}{devPct.toFixed(0)}%</span>
                    </div>
                    <div style={{ position: "relative", height: 8, background: "var(--raise)", borderRadius: 99 }}>
                      <div style={{ position: "absolute", top: -3, width: 2, height: 14, background: "var(--text)", borderRadius: 2, left: `${Math.min(96, (S.targetEC / 4) * 100)}%` }} />
                      <div style={{ height: "100%", width: `${Math.min(100, (S.ecMeasured / 4) * 100)}%`, background: ecState === "warn" ? "var(--amber)" : "var(--ec)", borderRadius: 99, transition: "width 1s" }} />
                    </div>
                  </div>
                  {ecState === "warn" && (
                    <div className="warnnote">EC menyimpang &gt;15% dari target — periksa stok nutrisi, pompa dosing, atau kalibrasi faktor.</div>
                  )}
                </>
              )}
            </section>

            <div className="grid2" style={{ marginBottom: 12 }}>
              <section className="panel">
                <div className="ptitle"><h2 className="mono">TANGKI {sys.toUpperCase()}</h2>{ctrlOff && <span className="psub mono" style={{ color: "var(--dim)" }}>OFFLINE</span>}</div>
                <div className="big mono">{ctrlOff ? "—" : Math.round(S.tankL)}<small> L</small></div>
                <div className="note mono" style={{ marginTop: 5, color: tankLow && !ctrlOff ? "var(--danger)" : "var(--dim)" }}>
                  / {S.tankCap} L {tankLow && !ctrlOff ? "· MIN!" : ""}
                </div>
                <div className={`bar ${tankLow && !ctrlOff ? "low" : ""}`}><div style={{ width: ctrlOff ? "0%" : `${(S.tankL / S.tankCap) * 100}%` }} /></div>
              </section>
              <section className="panel">
                <div className="ptitle"><h2 className="mono">TEKANAN</h2>{ctrlOff && <span className="psub mono" style={{ color: "var(--dim)" }}>OFFLINE</span>}</div>
                <div style={{ opacity: ctrlOff ? 0.35 : 1 }}><Gauge psi={ctrlOff ? 0 : S.psi} /></div>
              </section>
            </div>

            {/* Rantai pasok GH (dua tandon) — hanya panel GH */}
            {!S.hasRecharge && (
              <section className="panel" style={{ marginBottom: 12 }}>
                <div className="ptitle">
                  <h2 className="mono">RANTAI PASOK AIR</h2>
                  <span className="psub mono">sumur → RAW → GH</span>
                </div>
                <div className="rowitem">
                  <span className={`sdot ${S.floatRAW ? "ok" : "warn"}`} />
                  <div className="flex1">
                    <div style={{ fontSize: "13.5px" }}>Tandon RAW (penampung awal)</div>
                    <div className="note">Diisi pompa RAW (dikontrol OF2). Float sensor di GH.</div>
                  </div>
                  <span className={`pill ${S.floatRAW ? "ok" : "warn"}`}>{S.floatRAW ? "PENUH" : "BELUM"}</span>
                </div>
                <div className="rowitem" style={{ borderBottom: "none" }}>
                  <span className={`sdot ${S.floatGH ? "ok" : "warn"}`} />
                  <div className="flex1">
                    <div style={{ fontSize: "13.5px" }}>Tandon GH (guard float)</div>
                    <div className="note">Cadangan bila ultrasonik gagal baca level. Isi via pompa charge GH.</div>
                  </div>
                  <span className={`pill ${S.floatGH ? "ok" : "warn"}`}>{S.floatGH ? "PENUH" : "BELUM"}</span>
                </div>
              </section>
            )}

            {/* Volume distribusi (flow sensor YF-DN50) */}
            <section className="panel" style={{ marginBottom: 12, borderColor: (!ctrlOff && S.distActive) ? "var(--water)" : "var(--line)" }}>
              <div className="ptitle">
                <h2 className="mono">VOLUME DISTRIBUSI</h2>
                <span className="psub mono" style={{ color: (!ctrlOff && S.distActive) ? "var(--water)" : "var(--dim)" }}>
                  {ctrlOff ? "OFFLINE" : S.distActive ? "● MENGALIR" : "IDLE"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div className="mono" style={{ fontSize: 40, fontWeight: 700, color: (!ctrlOff && S.distActive) ? "var(--water)" : "var(--text)" }}>
                  {fnum(S.distLit)}
                </div>
                <div className="mono" style={{ fontSize: 15, color: "var(--dim)" }}>
                  L{S.distTarget > 0 ? ` / ${S.distTarget} target` : ""}
                </div>
              </div>
              <div className="note mono" style={{ marginTop: 6 }}>
                Volume sesi ini dari flow sensor YF-DN50. Total hari ini: {fnum(S.todayL)} L ({S.todayFreq}x).
              </div>
            </section>

            <section className="panel">
              <div className="ptitle">
                <h2 className="mono">IRIGASI 7 HARI</h2>
                <span className="psub mono">total {wt} L · {wf}x</span>
              </div>
              <div style={{ display: "flex", gap: 20, marginBottom: 10 }}>
                {[
                  [`${fnum(S.todayL, 1)} L`, `hari ini · ${S.todayFreq}x`, "#D7E5E0"],
                  [`${fnum(S.yesterdayL, 1)} L`, `kemarin · ${S.yesterdayFreq}x`, "#7FA39A"],
                  [`${fnum(S.perPoint, 2)}`, `L/titik${S.totalIrrPoints ? ` · ${S.totalIrrPoints} titik` : ""}`, "#7FA39A"],
                ].map(([v, l, col]) => (
                  <div key={l}>
                    <div className="mono" style={{ fontSize: 21, fontWeight: 700, color: col }}>{v}</div>
                    <div className="note">{l}</div>
                  </div>
                ))}
              </div>
              <svg viewBox="0 0 340 120" width="100%">
                {history.map((h, i) => {
                  const bh = (h.l / maxL) * 92;
                  return (
                    <g key={h.d}>
                      <rect x={(i * bw + 6).toFixed(1)} y={(100 - bh).toFixed(1)} width={(bw - 12).toFixed(1)} height={bh.toFixed(1)} rx="4"
                        fill={i === history.length - 1 ? "#53C8E8" : "rgba(83,200,232,.28)"} />
                      <text x={(i * bw + bw / 2).toFixed(1)} y="114" textAnchor="middle" fill="#7FA39A" fontSize="10">{h.day}</text>
                    </g>
                  );
                })}
              </svg>
              <div className="tbl" style={{ gridTemplateColumns: "1fr auto auto auto", marginTop: 8 }}>
                <div className="th mono">Tanggal</div><div className="th mono r">Frek</div>
                <div className="th mono r">Liter</div><div className="th mono r">L/x</div>
                {[...history].reverse().map((h) => (
                  <>
                    <div key={h.d + "a"} className="td" style={{ color: "var(--dim)" }}>{h.day} <span className="mono" style={{ fontSize: 11 }}>{h.d}</span></div>
                    <div key={h.d + "b"} className="td r mono" style={{ color: "var(--dim)" }}>{h.f}x</div>
                    <div key={h.d + "c"} className="td r mono" style={{ fontWeight: 700 }}>{h.l}</div>
                    <div key={h.d + "d"} className="td r mono" style={{ color: "var(--dim)" }}>{h.f ? Math.round(h.l / h.f) : "—"}</div>
                  </>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ==================== KONTROL ==================== */}
        {tab === "kontrol" && (
          <div>
            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">IRIGASI SEKARANG</h2></div>
              <div className="flex">
                <input type="number" inputMode="decimal" placeholder="Target liter" className="flex1"
                  value={targetInput} onChange={(e) => setTargetInput(e.target.value)} disabled={S.estop} />
                <button className="btn" onClick={doIrrigate} disabled={S.estop}>Mulai</button>
              </div>
              <p className="note" style={{ margin: "10px 0 0" }}>
                Valve buka 18 dtk → priming 60 dtk → pompa jalan sampai target.
                Nutrisi sudah tercampur di tandon (batch), bukan diinjeksi saat irigasi.
              </p>
              {tankLow && <div className="warnnote" style={{ color: "var(--danger)" }}>Tangki &lt;100 L — irigasi diblokir sampai recharge.</div>}
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle">
                <h2 className="mono">JADWAL IRIGASI</h2>
                <button onClick={() => setSchedFormOpen(!schedFormOpen)} disabled={S.estop}
                  style={{ border: "1px solid var(--water)", background: "transparent", color: "var(--water)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Archivo" }}>
                  {schedFormOpen ? "Tutup" : "+ Tambah"}
                </button>
              </div>
              {schedFormOpen && (
                <div style={{ marginBottom: 12, padding: 13, background: "var(--raise)", borderRadius: 11, display: "grid", gap: 11 }}>
                  <div className="flex">
                    <div className="flex1"><div className="lbl mono">JAM</div><input type="time" value={nsTime} onChange={(e) => setNsTime(e.target.value)} /></div>
                    <div className="flex1"><div className="lbl mono">LITER</div><input type="number" inputMode="decimal" placeholder="120" value={nsLiters} onChange={(e) => setNsLiters(e.target.value)} /></div>
                  </div>
                  <div>
                    <div className="lbl mono">HARI</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {DAYS.map((d, i) => (
                        <button key={d} className={`daybtn ${nsDays.includes(i) ? "sel" : ""}`}
                          onClick={() => setNsDays(nsDays.includes(i) ? nsDays.filter((x) => x !== i) : [...nsDays, i])}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="btn" onClick={saveSchedule}>Simpan jadwal</button>
                </div>
              )}
              {!S.schedules.length ? (
                <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "var(--dim)" }}>
                  Belum ada jadwal. Tambahkan supaya irigasi berjalan otomatis.
                </div>
              ) : (
                S.schedules.map((s) => {
                  const d = doseFor(S, s.liters);
                  const dayTxt = s.days.length === 7 ? "Setiap hari" : s.days.map((x) => DAYS[x]).join(" · ");
                  return (
                    <div key={s.id} className="rowitem" style={{ opacity: s.enabled ? 1 : 0.5 }}>
                      <div className="mono" style={{ fontSize: 19, fontWeight: 700, minWidth: 58 }}>{s.time}</div>
                      <div className="flex1">
                        <div style={{ fontSize: "13.5px", fontWeight: 600 }}>{s.liters} L</div>
                        <div className="note">{dayTxt}</div>
                      </div>
                      <button className={`tgl ${s.enabled ? "on" : ""}`} disabled={S.estop} onClick={() => toggleSchedule(s.id)} aria-label={`Jadwal ${s.time}`} />
                      <button onClick={() => deleteSchedule(s.id)} aria-label={`Hapus jadwal ${s.time}`}
                        style={{ border: "none", background: "transparent", color: "var(--danger)", fontSize: 17, cursor: "pointer", padding: "4px 6px" }}>✕</button>
                    </div>
                  );
                })
              )}
              {anySchedOn && (
                <div style={{ marginTop: 12, padding: 13, background: "var(--raise)", borderRadius: 11 }}>
                  <div className="mono" style={{ fontSize: "9.5px", letterSpacing: ".12em", color: "var(--dim)", fontWeight: 700, marginBottom: 9 }}>FREKUENSI PER HARI</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {DAYS.map((dn, di) => {
                      const ds = S.schedules.filter((s) => s.enabled && s.days.includes(di)).sort((a, b) => a.time.localeCompare(b.time));
                      const tot = ds.reduce((sum, s) => sum + s.liters, 0);
                      if (!ds.length) return (
                        <div key={dn} style={{ display: "flex", gap: 9 }}>
                          <div style={{ width: 32, fontSize: "11.5px", fontWeight: 700, color: "var(--dim)", opacity: 0.45 }}>{dn}</div>
                          <div style={{ fontSize: 11, color: "var(--dim)", opacity: 0.5 }}>—</div>
                        </div>
                      );
                      return (
                        <div key={dn} style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                          <div style={{ width: 32, fontSize: "11.5px", fontWeight: 700 }}>{dn}</div>
                          <div className="mono" style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--water)", minWidth: 20 }}>{ds.length}x</div>
                          <div className="mono flex1" style={{ fontSize: 11, color: "var(--dim)" }}>{ds.map((s) => s.time).join("  ")}</div>
                          <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{tot} L</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="note" style={{ marginTop: 8 }}>
                Cooldown antar-irigasi ditegakkan di perangkat. Jadwal tersimpan di device (v{S.schedVer}) — tetap jalan meski server offline.
              </div>
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">KONTROL MANUAL</h2><span className="psub mono">timeout 3 mnt</span></div>
              <div className="rowitem">
                <div className="flex1" style={{ fontSize: 14 }}>Valve motorized</div>
                <button className={`tgl ${S.valveOpen ? "on" : ""}`} disabled={S.estop} onClick={tglValve} aria-label="Valve" />
              </div>
              <div className="rowitem">
                <div className="flex1" style={{ fontSize: 14 }}>Pompa distribusi</div>
                <button className={`tgl ${S.pumpDist ? "on" : ""}`} disabled={S.estop} onClick={tglPump} aria-label="Pompa" />
              </div>
            </section>

            {/* Recharge sumur bor — HANYA sistem OF2 */}
            {S.hasRecharge && (
              <section className="panel" style={{ marginBottom: 12 }}>
                <div className="ptitle">
                  <h2 className="mono">RECHARGE AIR BAKU (POMPA RAW)</h2>
                  <span className="psub mono">dikendalikan OF2</span>
                </div>
                <p className="note" style={{ margin: "0 0 11px", fontSize: 12 }}>
                  Pompa RAW (relay di OF2) menyedot air dari sumur bor ke tandon RAW.
                  Tandon RAW adalah penampung awal yang lalu ditarik ke tandon GH.
                  Status penuh/belumnya dibaca sensor floatRAW di GH lalu dikirim ke
                  OF2 via jalur lokal untuk menyalakan/mematikan pompa RAW.
                </p>
                <div className="rowitem">
                  <div className="flex1">
                    <div style={{ fontSize: 14 }}>Mode recharge</div>
                    <div className="note">OFF · RAW (sumur) · OF2 (tandon) · Keduanya</div>
                  </div>
                  <select style={{ width: "auto" }} disabled={S.estop}
                    value={S.pumpRAW && S.pumpOF2 ? 3 : S.pumpRAW ? 1 : S.pumpOF2 ? 2 : 0}
                    onChange={(e) => setRecharge(+e.target.value)}>
                    <option value="0">OFF</option><option value="1">RAW</option>
                    <option value="2">OF2</option><option value="3">Keduanya</option>
                  </select>
                </div>
                <div className="rowitem" style={{ borderBottom: "none" }}>
                  <span className={`sdot ${S.floatRAW ? "ok" : "warn"}`} />
                  <div className="flex1" style={{ fontSize: "13px" }}>Float tandon RAW (sensor di GH)</div>
                  <span className={`pill ${S.floatRAW ? "ok" : "warn"}`}>{S.floatRAW ? "PENUH" : "BELUM"}</span>
                </div>
              </section>
            )}

            {/* Recharge GH — pompa charge GH (RAW->tandon GH). HANYA panel GH */}
            {!S.hasRecharge && (
              <section className="panel" style={{ marginBottom: 12 }}>
                <div className="ptitle">
                  <h2 className="mono">RECHARGE TANDON GH</h2>
                  <span className="psub mono">pompa charge GH</span>
                </div>
                <p className="note" style={{ margin: "0 0 11px", fontSize: 12 }}>
                  Pompa charge GH menarik air dari tandon RAW ke tandon GH.
                  Berhenti otomatis saat float GH penuh atau level ultrasonik tinggi.
                </p>
                <div className="rowitem">
                  <div className="flex1">
                    <div style={{ fontSize: 14 }}>Mode recharge</div>
                    <div className="note">Sticky: set sekali, pompa auto nyala saat level turun & mati saat penuh. Mode tetap walau pompa sedang mati.</div>
                  </div>
                  <select style={{ width: "auto" }} disabled={S.estop}
                    value={S.rechargeMode === 2 ? 2 : 0}
                    onChange={(e) => setRecharge(+e.target.value)}>
                    <option value="0">OFF</option>
                    <option value="2">Charge GH</option>
                  </select>
                </div>
                <div className="rowitem" style={{ opacity: 0.5 }}>
                  <span className="sdot" style={{ background: "var(--amber)" }} />
                  <div className="flex1" style={{ fontSize: "13px" }}>Tandon OF1 (ekspansi)</div>
                  <span className="pill" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>BELUM TERPASANG</span>
                </div>
                <div className="rowitem">
                  <span className={`sdot ${S.floatRAW ? "ok" : "warn"}`} />
                  <div className="flex1" style={{ fontSize: "13px" }}>Float tandon RAW</div>
                  <span className={`pill ${S.floatRAW ? "ok" : "warn"}`}>{S.floatRAW ? "PENUH" : "BELUM"}</span>
                </div>
                <div className="rowitem" style={{ borderBottom: "none" }}>
                  <span className={`sdot ${S.pumpChargeGH ? "ok" : ""}`} style={{ background: S.pumpChargeGH ? "var(--run)" : "var(--line)" }} />
                  <div className="flex1" style={{ fontSize: "13px" }}>Pompa charge GH</div>
                  <span className={`pill ${S.pumpChargeGH ? "on" : ""}`}>{S.pumpChargeGH ? "NYALA" : "MATI"}</span>
                </div>
              </section>
            )}

            <section className="panel" style={{ borderColor: "rgba(228,96,78,.4)", background: S.estop ? "rgba(228,96,78,.08)" : "var(--panel)" }}>
              <div className="ptitle"><h2 className="mono">PENGHENTIAN DARURAT</h2></div>
              {!S.estop && !estopArm && (
                <button className="btn outline-danger mono" onClick={() => setEstopArm(true)}>E-STOP {SYS_LABEL[sys].toUpperCase()}</button>
              )}
              {!S.estop && estopArm && (
                <div>
                  <p style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--danger)", margin: "0 0 10px" }}>
                    Semua pompa berhenti dan valve menutup. Lanjutkan?
                  </p>
                  <div className="flex">
                    <button className="btn danger flex1" onClick={fireEstop}>Ya, hentikan sekarang</button>
                    <button className="btn ghost" onClick={() => setEstopArm(false)}>Batal</button>
                  </div>
                </div>
              )}
              {S.estop && (
                <div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)", marginBottom: 10 }}>● E-STOP AKTIF</div>
                  <button className="btn ghost" style={{ width: "100%", borderColor: "var(--text)" }} onClick={releaseEstop}>Lepas E-STOP</button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ==================== DOSING ==================== */}
        {tab === "dosing" && (
          <div>
            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle">
                <h2 className="mono">EC TERUKUR vs TARGET</h2>
                <span className="psub mono" style={{ color: "var(--dim)" }}>
                  {ecMissing ? "BELUM TERPASANG" : ctrlOff ? "OFFLINE" : S.ecSensorOK ? "SENSOR OK" : "FAULT"}
                </span>
              </div>
              {ecMissing ? (
                <div className="raisebox" style={{ color: "var(--dim)", lineHeight: 1.7 }}>
                  Sensor EC/TDS belum terpasang. Dosing berjalan berbasis
                  <b style={{ color: "var(--text)" }}> volume + k-factor</b> (bukan closed-loop EC),
                  jadi tetap akurat selama kalibrasi faktor benar. Target EC di bawah
                  dipakai sebagai acuan hitung dosis, bukan dari pembacaan sensor.
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                    <div className="mono" style={{ fontSize: 34, fontWeight: 700, color: ecState === "warn" ? "var(--amber)" : "var(--ec)" }}>
                      {ctrlOff ? "—" : S.ecMeasured.toFixed(2)}
                    </div>
                    <div className="mono" style={{ fontSize: 14, color: "var(--dim)" }}>/ target {S.targetEC.toFixed(1)} mS/cm</div>
                    <div className="mono" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: ecState === "warn" ? "var(--amber)" : "var(--run)" }}>
                      {ctrlOff ? "—" : (dev >= 0 ? "+" : "") + devPct.toFixed(0) + "%"}
                    </div>
                  </div>
                  <div className="note mono" style={{ marginTop: 6 }}>
                    TDS {ctrlOff ? "—" : S.tdsMeasured} ppm · suhu {fnum(S.ecTemp, 1)}°C · air baku EC {ctrlOff ? "—" : S.ecRaw.toFixed(2)}
                  </div>
                </>
              )}
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle">
                <h2 className="mono">MIXING BATCH DI TANDON</h2>
                <span className="psub mono" style={{ color: "var(--amber)" }}>MENUNGGU HARDWARE</span>
              </div>
              <p className="note" style={{ margin: "0 0 11px", fontSize: 12, lineHeight: 1.7 }}>
                Model dosing: nutrisi A+B dicampur langsung di tandon (bukan injeksi
                inline), diaduk mixer, lalu air ter-nutrisi baru dipompa ke lahan.
                Dosis dihitung dari volume air baku yang masuk saat pengisian.
              </p>
              <div className="rowitem">
                <span className="sdot" style={{ background: "var(--amber)" }} />
                <div className="flex1">
                  <div style={{ fontSize: "13.5px" }}>Flow sensor air baku</div>
                  <div className="note">Ukur volume air masuk → acuan dosis A/B.</div>
                </div>
                <span className="pill" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>BELUM TERPASANG</span>
              </div>
              <div className="rowitem" style={{ borderBottom: "none" }}>
                <span className="sdot" style={{ background: "var(--amber)" }} />
                <div className="flex1">
                  <div style={{ fontSize: "13.5px" }}>Motor mixer</div>
                  <div className="note">Trigger ikut pompa air baku ({sys === "of2" ? "P-OF2" : "P-CHG"}) / jadwal pengisian.</div>
                </div>
                <span className="pill" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>BELUM TERPASANG</span>
              </div>
              <div className="rowitem" style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 12 }}>
                <div className="flex1">
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Auto-dose air baku</div>
                  <div className="note">Tiap 10 L air baku masuk → inject A {S.konsA}+B {S.konsB} ml/L otomatis. Matikan jika ingin dosing manual (mis. setelah cek TDS meter).</div>
                </div>
                <button
                  className="btn"
                  style={{
                    background: S.autoDose ? "var(--ok)" : "var(--raise)",
                    color: S.autoDose ? "#04150c" : "var(--dim)",
                    borderColor: S.autoDose ? "var(--ok)" : "var(--line)",
                    minWidth: 84,
                  }}
                  onClick={() => setAutoDose(!S.autoDose)}
                >
                  {S.autoDose ? "AKTIF" : "NONAKTIF"}
                </button>
              </div>
              {S.autoDose && (
                <div className="note" style={{ marginTop: 6 }}>
                  Air baku terpantau: <b style={{ color: "var(--text)" }}>{fnum(S.rawWaterSeen)} L</b>
                  {typeof S.autoDoseMlToday === "number" && <> · auto-dose hari ini: <b style={{ color: "var(--text)" }}>{Math.round(S.autoDoseMlToday)} ml</b></>}
                </div>
              )}
              <div className="warnnote" style={{ marginTop: 10 }}>
                Auto-dose butuh flow sensor air baku (YF-S201) terpasang di controller. Ada batas harian pengaman untuk cegah over-dose bila sensor bermasalah. Dosing manual di bawah tetap tersedia kapan pun.
              </div>
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">STOK NUTRISI</h2></div>
              {[["A", S.doseTankA, S.doseCapA, "var(--doseA)"], ["B", S.doseTankB, S.doseCapB, "var(--doseB)"]].map(([l, lv, cap, col]) => {
                const low = lv / cap < 0.2;
                return (
                  <div key={l} className="rowitem">
                    <div className="mono" style={{ width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center", border: `1px solid ${col}`, color: col, fontWeight: 800, fontSize: 12 }}>{l}</div>
                    <div className="flex1">
                      <div style={{ height: 7, background: "var(--raise)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(lv / cap) * 100}%`, background: low ? "var(--danger)" : col, transition: "width 1s" }} />
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 700, minWidth: 82, textAlign: "right" }}>
                      {lv.toFixed(1)}<span style={{ color: "var(--dim)", fontSize: 11 }}> / {cap} L</span>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">FAKTOR KONSENTRASI</h2></div>
              <p className="note" style={{ margin: "0 0 11px", fontSize: 12 }}>
                Kalibrasi: ml nutrisi per 1 L air → EC referensi. Contoh 10+10 ml → EC 2.0.
              </p>
              <div className="flex" style={{ marginBottom: 11 }}>
                <div className="flex1"><div className="lbl mono" style={{ color: "var(--doseA)" }}>A ml/L</div>
                  <input type="number" step="0.1" value={S.konsA} onChange={numField("konsA")} disabled={S.estop} /></div>
                <div className="flex1"><div className="lbl mono" style={{ color: "var(--doseB)" }}>B ml/L</div>
                  <input type="number" step="0.1" value={S.konsB} onChange={numField("konsB")} disabled={S.estop} /></div>
                <div className="flex1"><div className="lbl mono">EC HASIL</div>
                  <input type="number" step="0.1" value={S.refEC} onChange={numField("refEC")} disabled={S.estop} /></div>
              </div>
              <div className="flex" style={{ alignItems: "flex-end", marginBottom: 11 }}>
                <div className="flex1"><div className="lbl mono" style={{ color: "var(--text)" }}>TARGET EC / TDS</div>
                  <input type="number" step="0.1" value={S.targetEC} onChange={numField("targetEC")} disabled={S.estop} /></div>
                <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={setFactor} disabled={S.estop}>Set faktor</button>
              </div>
              <div className="rowitem" style={{ border: "none", padding: "0 0 11px", opacity: ecMissing ? 0.5 : 1 }}>
                <button className={`tgl sm ${S.useRawSensor && !ecMissing ? "on" : ""}`} disabled={ecMissing} onClick={() => {
                  if (ecMissing) return;
                  cmd("dose_config", { useRawSensor: !S.useRawSensor }, (p) => ({ ...p, useRawSensor: !p.useRawSensor }));
                  notify(!S.useRawSensor ? "Dosis dikompensasi EC air baku terukur." : "Kompensasi air baku dimatikan.");
                }} />
                <div className="flex1">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Kompensasi EC air baku (sensor)</div>
                  <div className="note">
                    {ecMissing
                      ? "Butuh sensor EC/TDS — nonaktif sampai sensor terpasang."
                      : `Nutrisi hanya menyumbang ${c.effEC.toFixed(2)} dari target ${S.targetEC.toFixed(1)} (air baku ${c.rawEC.toFixed(2)}).`}
                  </div>
                </div>
              </div>
              <div className="raisebox mono">
                <div style={{ color: "var(--dim)", fontSize: 9, letterSpacing: ".1em" }}>DOSIS PADA TARGET EC {S.targetEC.toFixed(1)}</div>
                <div>per 1 L air: <b style={{ color: "var(--doseA)" }}>A {c.mlA.toFixed(1)} ml</b> + <b style={{ color: "var(--doseB)" }}>B {c.mlB.toFixed(1)} ml</b></div>
                <div>per 100 L irigasi: <b style={{ color: "var(--doseA)" }}>A {(c.mlA / 10).toFixed(2)} L</b> + <b style={{ color: "var(--doseB)" }}>B {(c.mlB / 10).toFixed(2)} L</b></div>
              </div>
              <div className="rowitem" style={{ border: "none", padding: "12px 0 0", opacity: 0.5 }}>
                <button className="tgl sm" disabled />
                <div className="flex1">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Auto-dose mengikuti pengisian air baku</div>
                  <div className="note">Aktif setelah flow sensor air baku &amp; mixer terpasang. Saat ini pakai dosing manual.</div>
                </div>
              </div>
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">DOSING MANUAL</h2></div>
              <div className="flex" style={{ marginBottom: 11 }}>
                <div className="flex1"><div className="lbl mono" style={{ color: "var(--doseA)" }}>NUTRISI A (L)</div>
                  <input type="number" inputMode="decimal" placeholder="0.0" value={doseAIn} disabled={S.estop}
                    onChange={(e) => { setDoseAIn(e.target.value); if (S.ratioLock) setDoseBIn(e.target.value); }} /></div>
                <div className="flex1"><div className="lbl mono" style={{ color: "var(--doseB)" }}>NUTRISI B (L)</div>
                  <input type="number" inputMode="decimal" placeholder="0.0" value={doseBIn}
                    disabled={S.estop || S.ratioLock} onChange={(e) => setDoseBIn(e.target.value)} /></div>
              </div>
              <div className="rowitem" style={{ border: "none", padding: "0 0 12px" }}>
                <button className={`tgl sm ${S.ratioLock ? "on" : ""}`} onClick={() => {
                  const lock = !S.ratioLock;
                  setS((p) => ({ ...p, ratioLock: lock }));
                  if (lock) setDoseBIn(doseAIn);
                }} />
                <div style={{ fontSize: "12.5px", color: "var(--dim)" }}>Kunci rasio A : B = 1 : 1</div>
              </div>
              <button className="btn" style={{ width: "100%" }} onClick={sendDose} disabled={S.estop}>Kirim dosing</button>
              <div className="note" style={{ marginTop: 9 }}>Dijalankan unit Smart Dosing terpisah. Ditolak jika unit offline.</div>
            </section>

            {/* Guard lock: muncul saat alarm/e-stop aktif dari proteksi flow */}
            {LIVE && S.doserOnline !== false && (S.alarmA || S.alarmB || S.estopActive) && (
              <section className="panel" style={{ marginBottom: 12, borderColor: "var(--bad)" }}>
                <div className="ptitle"><h2 className="mono" style={{ color: "var(--bad)" }}>⚠ GUARD DOSING AKTIF</h2></div>
                <div className="note" style={{ marginBottom: 10 }}>
                  Proteksi flow menghentikan & mengunci dosing
                  {S.alarmA && " (pompa A)"}{S.alarmB && " (pompa B)"}.
                  Penyebab umum: flow sensor tersangkut, selang tersumbat, pompa bermasalah, atau durasi melewati batas.
                  Periksa fisik dulu, lalu klik reset.
                </div>
                <button className="btn" style={{ width: "100%", background: "var(--bad)", color: "#fff", borderColor: "var(--bad)" }}
                  onClick={resetGuardLock}>
                  Reset Guard (kembali normal)
                </button>
              </section>
            )}

            {/* Cleaning dosing */}
            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle">
                <h2 className="mono">CLEANING DOSING</h2>
                {S.doserOnline !== false && S.cleaning && <span className="psub mono" style={{ color: "var(--water)" }}>● BERJALAN</span>}
              </div>
              <div className="note" style={{ marginBottom: 10 }}>
                Bilas jalur dosing: pompa ON 5 dtk / OFF 5 dtk, diulang 10×. Gunakan untuk membersihkan sisa nutrisi di selang setelah pemakaian.
              </div>
              <button className="btn" style={{ width: "100%" }}
                onClick={startCleaning}
                disabled={S.doserOnline === false || S.cleaning || S.estop || S.alarmA || S.alarmB}>
                {S.cleaning ? "Cleaning berjalan…" : "Mulai Cleaning"}
              </button>
            </section>

            <section className="panel">
              <div className="ptitle"><h2 className="mono">RIWAYAT DOSING</h2></div>
              <div className="tbl" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                <div className="th mono">Tanggal</div>
                <div className="th mono r" style={{ color: "var(--doseA)" }}>A (L)</div>
                <div className="th mono r" style={{ color: "var(--doseB)" }}>B (L)</div>
                <div className="th mono r" style={{ color: "var(--ec)" }}>EC hasil</div>
                {[...doseHistory].reverse().map((h) => (
                  <>
                    <div key={h.d + "a"} className="td mono" style={{ fontSize: 12, color: "var(--dim)" }}>{h.d}</div>
                    <div key={h.d + "b"} className="td r mono" style={{ fontWeight: 700 }}>{h.a.toFixed(1)}</div>
                    <div key={h.d + "c"} className="td r mono" style={{ fontWeight: 700 }}>{h.b.toFixed(1)}</div>
                    <div key={h.d + "d"} className="td r mono" style={{ color: Math.abs(h.ec - 2.0) > 0.3 ? "var(--amber)" : "var(--ec)" }}>{h.ec.toFixed(2)}</div>
                  </>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ==================== STATUS ==================== */}
        {tab === "status" && (
          <div>
            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">SISTEM</h2></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                {[
                  ["WIFI", ctrlOff ? "—" : `${S.rssi} dBm`, ctrlOff ? "var(--dim)" : rssiState === "ok" ? "var(--run)" : rssiState === "warn" ? "var(--amber)" : "var(--danger)"],
                  ["HEAP", ctrlOff ? "—" : `${S.heapKb} KB`, ctrlOff ? "var(--dim)" : S.heapKb > 80 ? "var(--run)" : "var(--amber)"],
                  ["UPTIME", ctrlOff ? "—" : `${S.uptimeH.toFixed(1)} jam`, "var(--text)"],
                  ["JADWAL", `v${S.schedVer} · ${S.schedules.length}`, "var(--water)"],
                ].map(([l, v, col]) => (
                  <div key={l} style={{ background: "var(--raise)", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: col }}>{v}</div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--dim)", marginTop: 3, letterSpacing: ".08em" }}>{l}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">DEVICE SISTEM {SYS_LABEL[sys].toUpperCase()}</h2></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{sys === "of2" ? "OF2 — Irrigation + Recharge" : "GH — Irrigation"}</div>
                  <div className="note mono" style={{ fontSize: 10 }}>{sys === "of2" ? "ESP32 · HTTP poll + UDP lokal" : "ESP32 · HTTP poll"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`sdot ${S.systemEnabled ? "ok" : "warn"}`} />
                  <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>IRRIG</span>
                  <button
                    className={`tgl sm ${S.systemEnabled ? "on" : ""}`}
                    onClick={toggleSystem}
                    disabled={S.estop}
                    aria-label={S.systemEnabled ? "Matikan sistem" : "Nyalakan sistem"}
                  />
                </div>
              </div>
              <StatusRow
                name={sys === "of2" ? "OF2 — Irrigation + Recharge" : "GH — Irrigation"}
                detail={sys === "of2" ? "ESP32 · HTTP poll + UDP lokal" : "ESP32 · HTTP poll"}
                state={S.ctrlOnline ? "ok" : "fault"} text={S.ctrlOnline ? "ONLINE" : "OFFLINE"} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Smart Dosing {sys.toUpperCase()}</div>
                  <div className="note mono" style={{ fontSize: 10 }}>ESP32 · HTTP poll</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`sdot ${S.doserSystemEnabled !== false ? "ok" : "warn"}`} />
                  <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>DOSE</span>
                  <button
                    className={`tgl sm ${S.doserSystemEnabled !== false ? "on" : ""}`}
                    onClick={toggleDoserSystem}
                    disabled={!S.doserOnline}
                    aria-label={S.doserSystemEnabled !== false ? "Matikan dosing" : "Nyalakan dosing"}
                  />
                </div>
              </div>
              <StatusRow
                name={`Smart Dosing ${sys.toUpperCase()}`}
                detail="ESP32 · HTTP poll"
                state={S.doserOnline ? "ok" : "fault"} text={S.doserOnline ? "ONLINE" : "OFFLINE"} />
              <div className="rowitem">
                <div className="flex1">
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Restart Controller</div>
                  <div className="note" style={{ fontSize: 10 }}>Reboot ESP32 — WiFi reconnect otomatis</div>
                </div>
                <button
                  className="btn"
                  onClick={restartDevice}
                  disabled={ctrlOff}
                  style={{ background: "var(--run)", padding: "8px 16px", fontSize: 12 }}
                >
                  RESTART
                </button>
              </div>
              <div className="rowitem" style={{ borderBottom: "none" }}>
                <div className="flex1">
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Restart Smart Dosing</div>
                  <div className="note" style={{ fontSize: 10 }}>Reboot ESP32 dosing</div>
                </div>
                <button
                  className="btn"
                  onClick={restartDoser}
                  disabled={!S.doserOnline}
                  style={{ background: "var(--run)", padding: "8px 16px", fontSize: 12 }}
                >
                  RESTART
                </button>
              </div>
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">SENSOR</h2></div>
              <StatusRow name="Ultrasonik level tangki" detail="HC-SR04 · GPIO 18/19" state={ctrlOff ? "off" : S.usOK ? "ok" : "fault"} text={ctrlOff ? "—" : S.usOK ? "OK" : "FAULT"} last={ctrlOff ? "" : `${S.usLastCm.toFixed(1)} cm`} />
              <StatusRow name="Tekanan jalur" detail="Analog · GPIO 3" state={ctrlOff ? "off" : S.pressOK ? (psiWarn ? "warn" : "ok") : "fault"} text={ctrlOff ? "—" : S.pressOK ? (psiWarn ? "LUAR BATAS" : "OK") : "FAULT"} last={ctrlOff ? "" : `${S.psi.toFixed(1)} PSI`} />
              <StatusRow name="Flow meter DN50" detail="YF pulse · GPIO 15" state={ctrlOff ? "off" : S.flowOK ? "ok" : "fault"} text={ctrlOff ? "—" : S.flowOK ? "OK" : "FAULT"} last={ctrlOff ? "" : (S.flowLpm > 0 ? `${S.flowLpm.toFixed(0)} L/mnt` : "idle")} />
              <StatusRow name="EC / TDS industri" detail="Seeed · Modbus-RTU RS485"
                state={ecMissing ? "off" : ctrlOff ? "off" : S.ecSensorOK ? (Math.abs(devPct) > 15 ? "warn" : "ok") : "fault"}
                text={ecMissing ? "BELUM TERPASANG" : ctrlOff ? "—" : S.ecSensorOK ? "MODBUS OK" : "NO RESPONSE"}
                last={ecMissing || ctrlOff ? "" : `${S.ecMeasured.toFixed(2)} mS/cm`} />
              <StatusRow name={sys === "of2" ? "Float OF2" : "Float GH"} detail={sys === "of2" ? "Switch · GPIO 39" : "Switch · GPIO 38"} state={ctrlOff ? "off" : "ok"} text={ctrlOff ? "—" : (sys === "of2" ? S.floatOF2 : S.floatGH) ? "PENUH" : "BELUM PENUH"} />
              {sys === "gh" && (
                <StatusRow name="Float RAW (tandon awal)" detail="Switch · GPIO 20 → broadcast UDP"
                  state={ctrlOff ? "off" : "ok"} text={ctrlOff ? "—" : S.floatRAW ? "PENUH" : "BELUM PENUH"} />
              )}
            </section>

            <section className="panel" style={{ marginBottom: 12 }}>
              <div className="ptitle"><h2 className="mono">AKTUATOR</h2></div>
              {sys === "of2" ? (
                <>
                  <StatusRow name="Pompa RAW" detail="Relay R1 · GPIO 4 · isi tandon RAW (pemasok GH)" state={S.pumpRAW ? "ok" : "off"} text={S.pumpRAW ? "RUN" : "STOP"} />
                  <StatusRow name="Pompa OF2" detail="Relay R2 · GPIO 5 · isi tandon OF2" state={S.pumpOF2 ? "ok" : "off"} text={S.pumpOF2 ? "RUN" : "STOP"} />
                  <StatusRow name="Pompa distribusi" detail="Relay R3 · GPIO 13" state={S.pumpDist ? "ok" : "off"} text={S.pumpDist ? "RUN" : "STOP"} />
                  <StatusRow name="Valve motorized" detail="OPEN GPIO 21 · CLOSE GPIO 11 · travel 18 dtk"
                    state={S.valveMoving !== 0 ? "warn" : S.valveOpen ? "ok" : "off"}
                    text={S.valveMoving === 1 ? "MEMBUKA…" : S.valveMoving === 2 ? "MENUTUP…" : S.valveOpen ? "TERBUKA" : "TERTUTUP"} />
                </>
              ) : (
                <>
                  <StatusRow name="Pompa charge GH" detail="Relay R2 · GPIO 5 · tarik RAW → tandon GH" state={ctrlOff ? "off" : S.pumpChargeGH ? "ok" : "off"} text={ctrlOff ? "—" : S.pumpChargeGH ? "RUN" : "STOP"} />
                  <StatusRow name="Pompa charge OF1 (ekspansi)" detail="Relay R1 · GPIO 4 · belum di-wiring" state="off" text="N/A" />
                  <StatusRow name="Pompa distribusi" detail="Relay R3 · GPIO 13" state={ctrlOff ? "off" : S.pumpDist ? "ok" : "off"} text={ctrlOff ? "—" : S.pumpDist ? "RUN" : "STOP"} />
                  <StatusRow name="Solenoid distribusi" detail="Relay R6 · GPIO 21 · buka/tutup instan"
                    state={ctrlOff ? "off" : S.valveOpen ? "ok" : "off"}
                    text={ctrlOff ? "—" : S.valveOpen ? "TERBUKA" : "TERTUTUP"} />
                </>
              )}
              <StatusRow name="Pompa dosing A" detail="Smart Dosing" state={!S.doserOnline ? "fault" : S.pumpDoseA ? "ok" : "off"} text={!S.doserOnline ? "OFFLINE" : S.pumpDoseA ? "RUN" : "STOP"} />
              <StatusRow name="Pompa dosing B" detail="Smart Dosing" state={!S.doserOnline ? "fault" : S.pumpDoseB ? "ok" : "off"} text={!S.doserOnline ? "OFFLINE" : S.pumpDoseB ? "RUN" : "STOP"} />
            </section>

            <div className="note" style={{ padding: "0 4px" }}>
              Status FAULT pada sensor memicu blokir otomatis di perangkat (mis. ultrasonik fault memblokir irigasi).
              Float RAW menjadi STALE jika tidak ada sinyal &gt;2 menit — recharge RAW berhenti otomatis.
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)", textAlign: "center" }}>
              <a href="/admin.html" style={{ color: "var(--dim)", fontSize: 13, textDecoration: "none" }}>
                ⚙ Admin & Kalibrasi Device →
              </a>
              <div className="note" style={{ marginTop: 4, fontSize: 11 }}>Khusus owner: kelola user, kalibrasi sensor, parameter device.</div>
            </div>
          </div>
        )}
      </main>

      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>

      <nav>
        {["monitor", "kontrol", "dosing", "status"].map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}
