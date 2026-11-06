// pike-bridge.mjs v2 - WhatsApp self-chat como control remoto NATURAL de la PC.
//
// - Sin prefijos: CUALQUIER texto o NOTA DE VOZ en tu self-chat = una instruccion.
// - Voz -> transcrita local (faster-whisper, offline, gratis).
// - Lenguaje natural -> lo atiende una SESION de IA (claude, costo 0) que hace
//   el trabajo (edita archivos, corre comandos) y responde.
// - Multiples sesiones: /new /use /sessions, cada una con su carpeta y contexto.
// - Pantalla: "captura" / "graba 10" -> te manda imagen / video.
// - Acks por reaccion: ⏳ mientras trabaja, ✅ al terminar, ❌ si falla.
//
// Dispositivo propio (auth-bridge) -> coexiste con el MCP de WhatsApp de pi.
// Vincular 1 vez: node bridge-login.mjs. Arrancar: node pike-bridge.mjs
import { createWA, msgText } from "./wa-core.mjs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const execFileP = promisify(execFile);
const DIR = "C:/Users/fabia/whatsapp-mcp";
const TMP = os.tmpdir();
const PIKEWEB = "C:/Users/fabia/pike-web";
const CUE = "C:/Users/fabia/cue/cue.mjs";
const NODE = process.execPath;
const HOME_CWD = "C:/Users/fabia/OneDrive/Escritorio";
const SESS_FILE = path.join(DIR, "sessions.json");
const PAUSE_FLAG = path.join(DIR, "PAUSED.flag"); // control LOCAL: si existe, el bridge no procesa nada
const STTPY = path.join(DIR, "stt_server.py");
const GUIPY = path.join(DIR, "gui_server.py");
const PWMGR = "C:/Users/fabia/OneDrive/Escritorio/pwmgr/cli.mjs";
const SCREEN = path.join(DIR, "_screen.png");
const AGENT_TIMEOUT = 300000; // 5 min por instruccion
// capacidades que se le inyectan al agente de IA cada turno (ver pantalla + actuar)
const WASEND = path.join(DIR, "wa-send.mjs");
const GUI_SP = [
  "Eres el asistente de Fabian por WhatsApp y corres en SU PC Windows con control TOTAL (bash, python, archivos, GUI).",
  "El usuario te habla en lenguaje natural (texto o voz) y tu HACES la tarea y respondes corto.",
  "MOSTRARLE algo (imagen/video/audio/archivo): ejecuta  node '" + WASEND + "' <ruta> [titulo]  y se lo envia por WhatsApp.",
  "VER la pantalla: python -c \"import pyautogui;pyautogui.screenshot(r'" + SCREEN + "')\"  y LEE ese PNG con tu lectura de imagenes para ubicar coordenadas; si el usuario quiere verla, mandasela con wa-send.",
  "CONTROLAR: pyautogui.click(x,y) / pyautogui.write(txt,interval=0.02) / pyautogui.hotkey('ctrl','c') / pyautogui.press('enter') / pyautogui.scroll(n). Pantalla 3000x2000. Repite ver->actuar hasta lograrlo.",
  "GRABAR video de pantalla: ffmpeg -y -f gdigrab -framerate 10 -i desktop -t <seg> -vf scale=1280:-2 -c:v libx264 -pix_fmt yuv420p out.mp4  y envialo con wa-send.",
  "CLAVES/login de Fabian: node '" + PWMGR + "' get <nombre>  (usala, NUNCA la muestres).",
  "Se proactivo: si pide 'muestrame X' o 'abre Y' hazlo de punta a punta. Responde breve, es WhatsApp.",
].join(" ");

// ---------- estado de sesiones ----------
let S = { active: "main", voice: false, paused: false, sessions: {} };
function loadSess() {
  try { S = { ...S, ...JSON.parse(fs.readFileSync(SESS_FILE, "utf8")) }; } catch {}
  if (!S.sessions || !Object.keys(S.sessions).length) {
    S.sessions = { main: { sid: crypto.randomUUID(), cwd: HOME_CWD, started: false } };
    S.active = "main";
  }
  saveSess();
}
function saveSess() { try { fs.writeFileSync(SESS_FILE, JSON.stringify(S, null, 2)); } catch {} }
function isPaused() { try { return fs.existsSync(PAUSE_FLAG); } catch { return false; } }
function cur() { return S.sessions[S.active]; }
loadSess();

// ---------- WhatsApp ----------
const wa = await createWA({ authDir: path.join(DIR, "auth-bridge"), storePath: path.join(DIR, "store-bridge.json"), printQR: false });
console.error("[bridge] conectando a WhatsApp...");
await wa.waitConnected(60000);
console.error("[bridge] conectado.");

const rawId = wa.sock.user?.id || "";
const myNum = rawId.split(":")[0].split("@")[0];
const SELF = myNum + "@s.whatsapp.net";
const rawLid = wa.sock.user?.lid || "";
const myLid = rawLid.split(":")[0].split("@")[0];
console.error("[bridge] self =", SELF, "| lid =", myLid || "(?)");

let replyJid = SELF;
const sentIds = new Set();
const seen = new Set();
const START = Math.floor(Date.now() / 1000) - 5;
const busy = new Set(); // sesiones ocupadas

function isSelf(jid) {
  if (!jid) return false;
  if (jid === SELF) return true;
  if (jid.endsWith("@lid")) { const b = jid.split(":")[0].split("@")[0]; return !myLid || b === myLid; }
  return false;
}

// ---------- envio ----------
async function send(text) {
  for (const chunk of splitMsg(text)) {
    try { const r = await wa.sock.sendMessage(replyJid, { text: chunk }); if (r?.key?.id) sentIds.add(r.key.id); }
    catch (e) { console.error("[send]", e.message); }
  }
}
function splitMsg(t) {
  t = String(t || "");
  if (t.length <= 3500) return [t || "(vacio)"];
  const out = []; for (let i = 0; i < t.length; i += 3500) out.push(t.slice(i, i + 3500)); return out;
}
async function sendImage(p, caption = "") {
  const r = await wa.sock.sendMessage(replyJid, { image: { url: p }, caption }); if (r?.key?.id) sentIds.add(r.key.id);
}
async function sendVideo(p, caption = "") {
  const r = await wa.sock.sendMessage(replyJid, { video: { url: p }, caption }); if (r?.key?.id) sentIds.add(r.key.id);
}
async function sendVoice(text) {
  try {
    const mp3 = path.join(TMP, `tts_${Date.now()}.mp3`), ogg = mp3.replace(".mp3", ".ogg");
    await execFileP("python", ["-m", "edge_tts", "--voice", "es-MX-JorgeNeural", "--text", text.slice(0, 600), "--write-media", mp3], { timeout: 30000 });
    await execFileP("ffmpeg", ["-y", "-i", mp3, "-c:a", "libopus", "-b:a", "32k", ogg], { timeout: 20000 });
    const r = await wa.sock.sendMessage(replyJid, { audio: { url: ogg }, ptt: true, mimetype: "audio/ogg; codecs=opus" });
    if (r?.key?.id) sentIds.add(r.key.id);
    fs.unlink(mp3, () => {}); fs.unlink(ogg, () => {});
  } catch (e) { console.error("[voice]", e.message); }
}
async function react(m, emoji) { try { const r = await wa.sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: m.key } }); if (r?.key?.id) sentIds.add(r.key.id); } catch {} }

// ---------- GUI (pyautogui persistente) ----------
let gui = null, guiReady = false; const guiQ = [];
function startGUI() {
  gui = spawn("python", [GUIPY], { cwd: DIR, env: process.env });
  let buf = "";
  gui.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onGui(l); } });
  gui.stderr.on("data", () => {});
  gui.on("exit", () => { gui = null; guiReady = false; });
}
function onGui(line) { let o; try { o = JSON.parse(line); } catch { return; } if (o.ready) { guiReady = true; console.error("[gui] listo", o.size); return; } const j = guiQ.shift(); if (j) j(o); }
function guiDo(action) {
  if (!gui) startGUI();
  return new Promise((resolve) => { guiQ.push(resolve); const go = () => { if (guiReady && gui) gui.stdin.write(JSON.stringify(action) + "\n"); else setTimeout(go, 300); }; go(); });
}

// ---------- STT (faster-whisper persistente) ----------
let stt = null, sttReady = false; const sttQ = [];
function startSTT() {
  stt = spawn("python", [STTPY], { cwd: DIR, env: process.env });
  let buf = "";
  stt.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onStt(l); } });
  stt.stderr.on("data", () => {});
  stt.on("exit", () => { stt = null; sttReady = false; });
}
function onStt(line) {
  let o; try { o = JSON.parse(line); } catch { return; }
  if (o.ready) { sttReady = true; console.error("[stt] listo (" + o.model + ")"); return; }
  const job = sttQ.shift(); if (job) job(o);
}
function transcribe(wav) {
  if (!stt) startSTT();
  return new Promise((resolve) => {
    sttQ.push(resolve);
    const go = () => { if (sttReady && stt) stt.stdin.write(wav + "\n"); else setTimeout(go, 300); };
    go();
  });
}
async function voiceToText(m) {
  const ogg = path.join(TMP, `va_${Date.now()}.ogg`), wav = ogg.replace(".ogg", ".wav");
  await wa.downloadMedia(m.key.remoteJid, m.key.id, ogg);
  await execFileP("ffmpeg", ["-y", "-i", ogg, "-ar", "16000", "-ac", "1", wav], { timeout: 30000 });
  const r = await transcribe(wav);
  fs.unlink(ogg, () => {}); fs.unlink(wav, () => {});
  if (r.error) throw new Error(r.error);
  return (r.text || "").trim();
}

// ---------- acciones de pantalla ----------
async function doShot(m) {
  await react(m, "📸");
  const out = path.join(TMP, `shot_${Date.now()}.png`);
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
    "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;",
    "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;",
    "$g=[System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);",
    `$bmp.Save('${out.replace(/\\/g, "\\\\")}');`,
  ].join(" ");
  try {
    await execFileP("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 20000 });
    if (!fs.existsSync(out)) return send("no pude capturar la pantalla");
    await sendImage(out, "📸 pantalla"); await react(m, "✅"); fs.unlink(out, () => {});
  } catch (e) { await react(m, "❌"); send("shot err: " + e.message); }
}
async function doRec(sarg, m) {
  let secs = parseInt(sarg, 10); if (!secs || secs < 1) secs = 5; if (secs > 60) secs = 60;
  await react(m, "🎥");
  const out = path.join(TMP, `rec_${Date.now()}.mp4`);
  try {
    await execFileP("ffmpeg", ["-y", "-f", "gdigrab", "-framerate", "10", "-i", "desktop", "-t", String(secs),
      "-vf", "scale=1280:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", out],
      { timeout: (secs + 40) * 1000, maxBuffer: 1 << 24 });
    if (!fs.existsSync(out)) return send("no pude grabar");
    await sendVideo(out, `🎥 ${secs}s`); await react(m, "✅"); fs.unlink(out, () => {});
  } catch (e) { await react(m, "❌"); send("rec err: " + (e.message || "").slice(0, 150)); }
}
function doStatus(m) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync("C:/Users/fabia/.pi/agent/memory/memory.db", { readOnly: true });
    const rows = db.prepare("SELECT name,status,next_action FROM projects ORDER BY updated_at DESC LIMIT 15").all();
    const txt = rows.map(r => `${r.status || "⚪"} *${r.name}*\n  → ${(r.next_action || "").slice(0, 120)}`).join("\n");
    return send("*TABLERO*\n" + (txt || "(vacio)"));
  } catch (e) { return send("status err: " + e.message); }
}
async function doShell(cmd, m) {
  if (!cmd) return send("uso: /sh <comando>");
  await react(m, "⏳");
  try {
    const { stdout, stderr } = await execFileP("bash", ["-lc", cmd], { timeout: 120000, maxBuffer: 1 << 22, cwd: cur().cwd });
    const o = ((stdout || "") + (stderr ? "\n[err]\n" + stderr : "")).trim();
    await react(m, "✅");
    return send("```\n" + (o.slice(-3000) || "(sin salida)") + "\n```");
  } catch (e) { await react(m, "❌"); return send("sh err: " + (e.message || "").slice(0, 400)); }
}

// ---------- agente IA (claude) por sesion ----------
function runAgent(text, m) {
  const s = cur(), name = S.active;
  if (busy.has(name)) { return send(`⏳ la sesion *${name}* esta trabajando. Espera o crea otra con /new <nombre>.`); }
  busy.add(name);
  react(m, "⏳");
  const first = !s.started;
  const flag = first ? "--session-id" : "--resume";
  s.started = true; saveSess();
  const cmd = `printf '%s' "$PIKE_PROMPT" | claude -p --dangerously-skip-permissions --append-system-prompt "$PIKE_SP" ${flag} ${s.sid}`;
  const cp = spawn("bash", ["-lc", cmd], { cwd: s.cwd, env: { ...process.env, PIKE_PROMPT: text, PIKE_SP: GUI_SP } });
  let out = "", err = "";
  cp.stdout.on("data", d => out += d);
  cp.stderr.on("data", d => err += d);
  const to = setTimeout(() => { try { cp.kill(); } catch {} }, AGENT_TIMEOUT);
  cp.on("exit", async () => {
    clearTimeout(to); busy.delete(name);
    const reply = (out.trim() || err.trim() || "(sin respuesta)").slice(0, 8000);
    await react(m, out.trim() ? "✅" : "❌");
    const multi = Object.keys(S.sessions).length > 1;
    await send((multi ? `「${name}」\n` : "") + reply);
    if (S.voice && out.trim()) await sendVoice(reply);
  });
}

// ---------- comandos / ----------
async function slash(text, m) {
  const sp = text.indexOf(" ");
  const cmd = (sp < 0 ? text : text.slice(0, sp)).slice(1).toLowerCase();
  const arg = sp < 0 ? "" : text.slice(sp + 1).trim();
  switch (cmd) {
    case "help": return send(HELP);
    case "shot": return doShot(m);
    case "rec": return doRec(arg, m);
    case "status": return doStatus(m);
    case "sh": return doShell(arg, m);
    case "sessions": case "ls": {
      const list = Object.entries(S.sessions).map(([n, s]) =>
        `${n === S.active ? "➡️" : "  "} *${n}*  📁 ${s.cwd}`).join("\n");
      return send("*SESIONES*\n" + list + `\n\n🔊 voz: ${S.voice ? "on" : "off"}`);
    }
    case "new": {
      const [n, ...rest] = arg.split(/\s+/); if (!n) return send("uso: /new <nombre> [carpeta]");
      S.sessions[n] = { sid: crypto.randomUUID(), cwd: rest.join(" ") || HOME_CWD, started: false };
      S.active = n; saveSess(); return send(`✅ sesion *${n}* creada y activa\n📁 ${S.sessions[n].cwd}`);
    }
    case "use": {
      if (!S.sessions[arg]) return send(`no existe *${arg}*. /sessions para ver.`);
      S.active = arg; saveSess(); return send(`➡️ activa: *${arg}*\n📁 ${cur().cwd}`);
    }
    case "rename": {
      const [o, n] = arg.split(/\s+/); if (!o || !n || !S.sessions[o]) return send("uso: /rename <viejo> <nuevo>");
      S.sessions[n] = S.sessions[o]; delete S.sessions[o]; if (S.active === o) S.active = n; saveSess();
      return send(`✏️ *${o}* -> *${n}*`);
    }
    case "cd": { if (!arg) return send("uso: /cd <carpeta>"); cur().cwd = arg; saveSess(); return send(`📁 ${arg}`); }
    // --- control de GUI ---
    case "grid": { await react(m, "🧭"); const p = path.join(TMP, `grid_${Date.now()}.png`); const r = await guiDo({ act: "grid", path: p, step: 200 }); if (r.error) { await react(m, "❌"); return send("grid err: " + r.error); } await sendImage(p, "🧭 dime: /click X Y"); await react(m, "✅"); fs.unlink(p, () => {}); return; }
    case "click": case "dclick": case "rclick": {
      const [x, y] = arg.split(/[ ,]+/).map(Number); if (isNaN(x) || isNaN(y)) return send(`uso: /${cmd} X Y`);
      const r = await guiDo({ act: "click", x, y, clicks: cmd === "dclick" ? 2 : 1, button: cmd === "rclick" ? "right" : "left" });
      return send(r.ok ? `🖱️ ${cmd} ${x},${y}` : "err: " + r.error);
    }
    case "move": { const [x, y] = arg.split(/[ ,]+/).map(Number); if (isNaN(x) || isNaN(y)) return send("uso: /move X Y"); const r = await guiDo({ act: "move", x, y }); return send(r.ok ? `➡️ ${x},${y}` : "err: " + r.error); }
    case "drag": { const [x1, y1, x2, y2] = arg.split(/[ ,]+/).map(Number); if ([x1, y1, x2, y2].some(isNaN)) return send("uso: /drag X1 Y1 X2 Y2"); const r = await guiDo({ act: "drag", x1, y1, x2, y2 }); return send(r.ok ? `🖱️ drag` : "err: " + r.error); }
    case "type": { if (!arg) return send("uso: /type <texto>"); const r = await guiDo({ act: "type", text: arg }); return send(r.ok ? "⌨️ escrito" : "err: " + r.error); }
    case "key": { if (!arg) return send("uso: /key <combo> (enter, win+r, ctrl+c...)"); const r = await guiDo({ act: "key", keys: arg.toLowerCase() }); return send(r.ok ? `⌨️ ${arg}` : "err: " + r.error); }
    case "scroll": { const n = parseInt(arg, 10) || -500; const r = await guiDo({ act: "scroll", amount: n }); return send(r.ok ? `🖱️ scroll ${n}` : "err: " + r.error); }
    case "paste": {
      if (!arg) return send("uso: /paste <nombre-secreto>");
      try { const { stdout } = await execFileP(NODE, [PWMGR, "get", arg], { timeout: 10000 }); const val = (stdout || "").trim(); if (!val) return send("secreto vacio o inexistente"); const r = await guiDo({ act: "type", text: val }); return send(r.ok ? `🔐 escrito secreto *${arg}* (oculto)` : "err: " + r.error); }
      catch (e) { return send("paste err: " + e.message); }
    }
    case "rm": { if (S.sessions[arg] && arg !== "main") { delete S.sessions[arg]; if (S.active === arg) S.active = "main"; saveSess(); return send(`🗑️ ${arg} eliminada`); } return send("no puedo borrar esa"); }
    case "voice": { S.voice = /on|1|si/i.test(arg); saveSess(); return send(`🔊 respuestas por voz: ${S.voice ? "ON" : "OFF"}`); }
    case "reset": { cur().started = false; cur().sid = crypto.randomUUID(); saveSess(); return send(`♻️ contexto de *${S.active}* reiniciado`); }
    case "run": { const [n, ...c] = arg.split(/\s+/); return bgRun(n, c.join(" ")); }
    case "logs": return bgLogs(arg);
    case "kill": return bgKill(arg);
    default: return send(`comando /${cmd} desconocido. /help`);
  }
}

// ---------- procesos en background (terminales crudas) ----------
const bg = new Map();
function bgRun(name, command) {
  if (!name || !command) return send("uso: /run <nombre> <comando>");
  const log = path.join(TMP, `bg_${name}.log`);
  fs.writeFileSync(log, "");
  const cp = spawn("bash", ["-lc", command], { cwd: cur().cwd, env: process.env });
  const ws = fs.createWriteStream(log, { flags: "a" });
  cp.stdout.pipe(ws); cp.stderr.pipe(ws);
  bg.set(name, { cp, log });
  cp.on("exit", (c) => { try { ws.end(`\n[exit ${c}]\n`); } catch {} });
  return send(`▶️ *${name}* corriendo (pid ${cp.pid}). /logs ${name} para ver salida.`);
}
function bgLogs(name) {
  const b = bg.get(name); if (!b) return send(`no hay proceso *${name}*. /run <n> <cmd>`);
  try { const t = fs.readFileSync(b.log, "utf8").slice(-3000); return send(`*${name}*\n\`\`\`\n${t || "(sin salida aun)"}\n\`\`\``); }
  catch { return send("no pude leer el log"); }
}
function bgKill(name) {
  const b = bg.get(name); if (!b) return send(`no hay *${name}*`);
  try { b.cp.kill(); } catch {} bg.delete(name); return send(`⏹️ *${name}* detenido`);
}

const HELP = [
  "*Pike remoto* — escribe o manda audio, en lenguaje natural.",
  "",
  "Di lo que quieres y la *sesion de IA* lo hace (crea/edita archivos, corre comandos, y puede VER la pantalla y navegar apps) y te responde.",
  "",
  "*Sesiones* (contextos independientes)",
  "  @nombre <msg> - hablar a esa sesion (y activarla)",
  "  @nombre - solo cambiar a esa sesion",
  "  /sessions - listar  |  /new <nombre> [carpeta]",
  "  /use <n>  |  /rename <a> <b>  |  /rm <n>",
  "  /cd <carpeta>  |  /reset (olvidar contexto)",
  "",
  "*Pantalla*",
  "  captura  /  /shot - foto de pantalla",
  "  graba 10  /  /rec 10 - video 10s",
  "  /grid - captura con cuadricula de coordenadas",
  "",
  "*Control mouse/teclado*",
  "  /click X Y  /dclick  /rclick  /move X Y",
  "  /drag X1 Y1 X2 Y2  /scroll <n>",
  "  /type <texto>  /key <combo> (enter, win+r, ctrl+c)",
  "  /paste <secreto> - escribe una clave guardada (oculta)",
  "",
  "*Terminal*",
  "  /sh <cmd>  /run <n> <cmd>  /logs <n>  /kill <n>",
  "",
  "*Otros*",
  "  /status - tablero  |  /voice on|off",
].join("\n");

// ---------- deteccion natural de contextos/sesiones ----------
function cleanName(s) {
  return (s || "").trim()
    .replace(/^(el|la|los|las|mi|un|una|de|del)\s+/i, "")
    .replace(/[.?!,]+$/, "").split(/\s+/).slice(0, 3).join(" ").trim();
}
const SKW = "(contexto|contextos|sesion|sesi\u00f3n|sesiones|conversaci\u00f3n|conversacion|conversaciones)";
function parseSession(text) {
  const low = text.toLowerCase().trim();
  if (new RegExp(`^(qu[e\u00e9]|cu[a\u00e1]les|lista|listar|mis|ver|mostrar|mu[e\u00e9]strame|dame).{0,15}${SKW}`, "i").test(low)
    || new RegExp(`^${SKW}$`, "i").test(low))
    return { kind: "list" };
  let m = text.match(new RegExp(`\\b(nuevo|nueva|crea|crear|cre[a\u00e1]me|abre|abr[i\u00ed]|empez[a-z]*|inicia|iniciar|arranca)\\b.{0,12}${SKW}\\s*(?:(?:llamad[oa]|para|de|sobre) |:)?\\s*(.*)`, "i"));
  if (m) return { kind: "create", name: cleanName(m[3]) };
  m = text.match(new RegExp(`\\b(cambia|cambiar|c[a\u00e1]mbiame|ve|vamos|volvamos|volver|pasa|pasar|ir|usa|usar|entra|entrar|activa|activar)\\b.{0,12}(?:a[l]?\\s+)?${SKW}\\s+(?:de\\s+|llamad[oa]\\s+)?(.+)`, "i"));
  if (m) { const name = cleanName(m[3]); if (name) return { kind: "switch", name }; }
  return null;
}
function listSessions() {
  const list = Object.entries(S.sessions).map(([n, s]) => `${n === S.active ? "\u27a1\ufe0f" : "  "} *${n}*  \ud83d\udcc1 ${s.cwd}`).join("\n");
  return send("*CONTEXTOS*\n" + list);
}
function findSession(name) {
  const keys = Object.keys(S.sessions);
  return keys.find(k => k.toLowerCase() === name.toLowerCase())
    || keys.find(k => k.toLowerCase().includes(name.toLowerCase()));
}

// ---------- router ----------
async function route(text, m) {
  text = (text || "").trim(); if (!text) return;
  replyJid = m.key.remoteJid;
  // --- gate de pausa LOCAL: si existe el flag en la PC, ignorar TODO en silencio ---
  if (isPaused()) return;
  if (text.startsWith("/")) return slash(text, m);
  if (text.startsWith("@")) {
    const sp = text.indexOf(" ");
    const name = (sp < 0 ? text : text.slice(0, sp)).slice(1);
    const rest = sp < 0 ? "" : text.slice(sp + 1).trim();
    if (!S.sessions[name]) return send(`no existe *${name}*. /new ${name} para crearla.`);
    S.active = name; saveSess();
    if (!rest) return send(`➡️ activa: *${name}*\n📁 ${cur().cwd}`);
    return runAgent(rest, m);
  }
  const ss = parseSession(text);
  if (ss) {
    if (ss.kind === "list") return listSessions();
    if (ss.kind === "create") {
      let name = ss.name || ("ctx" + (Object.keys(S.sessions).length + 1));
      if (S.sessions[name]) { S.active = name; saveSess(); return send(`➡️ ya existía, activo *${name}*`); }
      S.sessions[name] = { sid: crypto.randomUUID(), cwd: cur()?.cwd || HOME_CWD, started: false };
      S.active = name; saveSess();
      return send(`✨ contexto *${name}* creado y activo. Háblame y empiezo fresco aquí.`);
    }
    if (ss.kind === "switch") {
      const found = findSession(ss.name);
      if (!found) return send(`no tengo un contexto *${ss.name}*. Dime "nuevo contexto ${ss.name}" y lo creo.`);
      S.active = found; saveSess();
      return send(`➡️ ahora en *${found}*  📁 ${cur().cwd}`);
    }
  }
  const low = text.toLowerCase();
  if (/\b(captura|pantallazo|screenshot|screen ?shot)\b/.test(low) || /(foto|muestra|muestrame|ver|ense[nñ]a).{0,14}pantalla/.test(low))
    return doShot(m);
  if (/\b(graba|grabar|record|grabacion)\b/.test(low) && /(pantalla|screen|seg|segundo|\d)/.test(low))
    return doRec((low.match(/(\d+)/) || [])[1] || "5", m);
  if (/^(status|estado|tablero|avances?)\b/.test(low) && low.length < 18)
    return doStatus(m);
  return runAgent(text, m);
}

// ---------- listener push + re-attach ----------
function attachListener() {
  wa.sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) {
      try {
        if (!m.key?.fromMe || !isSelf(m.key.remoteJid)) continue;
        if (isPaused()) continue; // control LOCAL: pausado en la PC -> no procesar nada
        if (sentIds.has(m.key.id) || seen.has(m.key.id)) continue;
        if (m.message?.reactionMessage || m.message?.protocolMessage) continue;
        const ts = Number(m.messageTimestamp || 0); if (ts && ts < START) continue;
        let text = "";
        if (m.message?.audioMessage) {
          seen.add(m.key.id);
          await react(m, "👂");
          try { text = await voiceToText(m); } catch (e) { await react(m, "❌"); await send("no pude transcribir: " + e.message); continue; }
          if (!text) { await send("no entendi el audio 🤔"); continue; }
          await send("🗣️ _" + text + "_");
        } else {
          text = msgText(m);
          if (!text) continue;
          seen.add(m.key.id);
        }
        console.error("[in]", JSON.stringify(text).slice(0, 60));
        await route(text, m);
      } catch (e) { console.error("[listener]", e.message); }
    }
  });
}
let boundSock = null;
function ensureAttached() { if (wa.sock && wa.sock !== boundSock) { boundSock = wa.sock; attachListener(); console.error("[bridge] listener attached"); } }
ensureAttached();
setInterval(ensureAttached, 4000);

// ---------- outbox: la IA te envia archivos/medios ----------
const OUTBOX = path.join(DIR, "outbox.jsonl");
let outOffset = 0;
try { outOffset = fs.existsSync(OUTBOX) ? fs.statSync(OUTBOX).size : 0; } catch {}
async function sendFile(p, caption = "") {
  if (!p || !fs.existsSync(p)) return;
  const ext = path.extname(p).toLowerCase();
  try {
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) await sendImage(p, caption);
    else if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) await sendVideo(p, caption);
    else if ([".ogg", ".mp3", ".m4a", ".wav", ".opus"].includes(ext)) { const r = await wa.sock.sendMessage(replyJid, { audio: { url: p }, mimetype: "audio/mpeg" }); if (r?.key?.id) sentIds.add(r.key.id); }
    else { const r = await wa.sock.sendMessage(replyJid, { document: { url: p }, fileName: path.basename(p), caption }); if (r?.key?.id) sentIds.add(r.key.id); }
    console.error("[outbox] enviado", path.basename(p));
  } catch (e) { console.error("[sendFile]", e.message); }
}
async function pollOutbox() {
  try {
    if (!fs.existsSync(OUTBOX)) return;
    const size = fs.statSync(OUTBOX).size;
    if (size <= outOffset) { if (size < outOffset) outOffset = 0; return; }
    const fd = fs.openSync(OUTBOX, "r");
    const buf = Buffer.alloc(size - outOffset);
    fs.readSync(fd, buf, 0, buf.length, outOffset);
    fs.closeSync(fd);
    outOffset = size;
    for (const line of buf.toString().split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      await sendFile(o.path, o.caption || "");
    }
  } catch (e) { console.error("[outbox]", e.message); }
}
setInterval(pollOutbox, 1500);

await send([
  "🤖 *Pike remoto ONLINE*",
  "",
  "Solo hablame normal (texto o voz). Yo entiendo y lo hago.",
  "Puedo ver y controlar tu compu, mostrarte la pantalla, grabar video, abrir apps y manejar archivos.",
  "",
  "Ej: _muestrame la pantalla_ · _abre el navegador y entra a gmail_ · _graba 10 segundos_ · _crea un archivo notas.txt_",
  "",
  "(atajos opcionales con /help)",
].join("\n"));
console.error("[bridge] v2.2 escuchando (lenguaje natural + outbox)");
