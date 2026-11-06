// wa-core.mjs - conexion Baileys + store liviano de chats/mensajes.
// Lo comparten wa-login.mjs (escanear QR) y whatsapp-mcp.mjs (operar).
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AUTH = path.join(__dirname, "auth");
const DEFAULT_STORE = path.join(__dirname, "store.json");

const logger = pino({ level: process.env.WA_LOG_LEVEL || "silent" });

// --- store liviano en memoria CON persistencia a disco ---
// Baileys ya no trae makeInMemoryStore, y el historial solo llega una vez al
// vincular -> hay que persistir o se pierde en cada reinicio del proceso.
import fs from "node:fs";

function makeStore(persistPath) {
  const chats = new Map(); // jid -> { id, name, conversationTimestamp, unreadCount }
  const contacts = new Map(); // jid -> { id, name, notify }
  const messages = new Map(); // jid -> Map(msgId -> fullMsg)

  // cargar snapshot previo
  if (persistPath && fs.existsSync(persistPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(persistPath, "utf8"));
      for (const c of raw.chats || []) chats.set(c.id, c);
      for (const ct of raw.contacts || []) contacts.set(ct.id, ct);
      for (const [jid, arr] of Object.entries(raw.messages || {})) {
        const map = new Map();
        for (const m of arr) map.set(m.key.id, m);
        messages.set(jid, map);
      }
    } catch (e) {
      console.error("[wa] no se pudo cargar store:", e.message);
    }
  }

  let saveTimer = null;
  const save = () => {
    if (!persistPath) return;
    if (saveTimer) return; // debounce
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const out = {
          chats: [...chats.values()],
          contacts: [...contacts.values()],
          messages: Object.fromEntries(
            [...messages.entries()].map(([jid, map]) => [jid, [...map.values()]])
          ),
        };
        fs.writeFileSync(persistPath, JSON.stringify(out));
      } catch (e) {
        console.error("[wa] no se pudo guardar store:", e.message);
      }
    }, 2000);
  };

  const enrich = (m) => {
    // captura pushName y telefono real para dar nombres legibles
    try {
      const k = m.key || {};
      const sender = k.participant || k.remoteJid;
      if (m.pushName && sender && !k.fromMe) {
        const ct = contacts.get(sender) || { id: sender };
        if (!ct.notify && !ct.name) ct.notify = m.pushName;
        contacts.set(sender, ct);
      }
      // mapa lid -> telefono (participantPn)
      if (k.participant && k.participantPn) {
        const ct = contacts.get(k.participant) || { id: k.participant };
        ct.phone = k.participantPn.split("@")[0];
        contacts.set(k.participant, ct);
      }
    } catch {}
  };

  const addMsg = (m) => {
    const jid = m.key?.remoteJid;
    if (!jid) return;
    enrich(m);
    if (!messages.has(jid)) messages.set(jid, new Map());
    messages.get(jid).set(m.key.id, m);
    // recorta a 500 por chat
    const map = messages.get(jid);
    if (map.size > 500) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
    save();
  };

  // enriquecer nombres a partir del store ya cargado (mensajes embebidos + Map)
  const enrichAll = () => {
    for (const map of messages.values()) for (const m of map.values()) enrich(m);
    for (const ch of chats.values())
      for (const wrap of ch.messages || []) if (wrap?.message) enrich(wrap.message);
  };

  return {
    chats,
    contacts,
    messages,
    addMsg,
    save,
    enrichAll,
    nameFor(jid) {
      if (!jid) return jid;
      const c = contacts.get(jid);
      const ch = chats.get(jid);
      const isGroup = jid.endsWith("@g.us");
      return (
        c?.name ||
        c?.notify ||
        ch?.name ||
        ch?.subject ||
        (c?.phone ? "+" + c.phone : null) ||
        (jid.endsWith("@s.whatsapp.net") ? "+" + jid.split("@")[0] : null) ||
        (isGroup ? "(grupo) " + jid.split("@")[0] : jid)
      );
    },
    bind(sock) {
      sock.ev.on("messaging-history.set", ({ chats: c, contacts: ct, messages: ms }) => {
        for (const ch of c || []) chats.set(ch.id, { ...chats.get(ch.id), ...ch });
        for (const co of ct || []) contacts.set(co.id, { ...contacts.get(co.id), ...co });
        for (const m of ms || []) addMsg(m);
        save();
      });
      sock.ev.on("chats.upsert", (cs) => { cs.forEach((c) => chats.set(c.id, { ...chats.get(c.id), ...c })); save(); });
      sock.ev.on("chats.update", (cs) => {
        cs.forEach((c) => chats.set(c.id, { ...chats.get(c.id), ...c })); save();
      });
      sock.ev.on("contacts.upsert", (cs) => { cs.forEach((c) => contacts.set(c.id, { ...contacts.get(c.id), ...c })); save(); });
      sock.ev.on("contacts.update", (cs) => {
        cs.forEach((c) => contacts.set(c.id, { ...contacts.get(c.id), ...c })); save();
      });
      sock.ev.on("messages.upsert", ({ messages: ms }) => ms.forEach(addMsg));
    },
  };
}

// --- extrae texto legible de un mensaje baileys ---
export function msgText(m) {
  const mm = m.message;
  if (!mm) return "";
  return (
    mm.conversation ||
    mm.extendedTextMessage?.text ||
    mm.imageMessage?.caption ||
    mm.videoMessage?.caption ||
    mm.documentMessage?.caption ||
    (mm.reactionMessage ? `[react ${mm.reactionMessage.text}]` : "") ||
    (mm.imageMessage ? "[imagen]" : "") ||
    (mm.videoMessage ? "[video]" : "") ||
    (mm.audioMessage ? "[audio]" : "") ||
    (mm.documentMessage ? `[doc ${mm.documentMessage.fileName || ""}]` : "") ||
    (mm.stickerMessage ? "[sticker]" : "") ||
    ""
  );
}

export async function createWA({ authDir = DEFAULT_AUTH, printQR = false, storePath = DEFAULT_STORE } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const store = makeStore(storePath);
  store.enrichAll(); // poblar nombres/telefonos desde el store persistido

  let sock = null;
  let connected = false;
  let lastQR = null;
  let readyResolve;
  let ready = new Promise((r) => (readyResolve = r));
  const waiters = []; // resolvers esperando a 'open'

  function start() {
    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: printQR,
      markOnlineOnConnect: false,
      syncFullHistory: true,
    });

    store.bind(sock);
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) lastQR = qr;
      if (connection) console.error(`[wa] connection=${connection}`);
      if (connection === "open") {
        connected = true;
        lastQR = null;
        readyResolve(api);
        while (waiters.length) waiters.shift()(api);
        // traer nombres de grupos en bg (no bloquea)
        setTimeout(() => api.syncGroupNames().catch(() => {}), 2000);
      }
      if (connection === "close") {
        connected = false;
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.error(`[wa] conexion cerrada (code=${code}) loggedOut=${loggedOut}`);
        if (!loggedOut) {
          // reconectar sobre el MISMO objeto (code 515 restart / 440 conflict / red)
          const delay = code === DisconnectReason.restartRequired ? 500 : 3000;
          // renovar la promesa ready para el proximo 'open'
          ready = new Promise((r) => (readyResolve = r));
          setTimeout(() => start(), delay);
        } else {
          console.error("[wa] loggedOut: hay que re-vincular con wa-login.mjs");
        }
      }
    });
  }

  start();

  const api = {
    get sock() { return sock; },
    store,
    get ready() { return ready; },
    isConnected: () => connected,
    waitConnected: (ms = 15000) =>
      connected
        ? Promise.resolve(api)
        : Promise.race([
            new Promise((r) => waiters.push(r)),
            new Promise((_, x) => setTimeout(() => x(new Error("timeout esperando conexion WhatsApp")), ms)),
          ]),
    getQR: () => lastQR,
    saveCreds,

    // ---- API de alto nivel ----
    async syncGroupNames() {
      // trae el subject real de TODOS los grupos de una sola vez
      try {
        const groups = await sock.groupFetchAllParticipating();
        let n = 0;
        for (const [jid, meta] of Object.entries(groups || {})) {
          const ch = store.chats.get(jid) || { id: jid };
          if (meta.subject) { ch.subject = meta.subject; n++; }
          store.chats.set(jid, ch);
        }
        store.save();
        return { groups: n };
      } catch (e) {
        return { error: e.message };
      }
    },

    async listChats({ limit = 30 } = {}) {
      const lastMsgOf = (c) => {
        const map = store.messages.get(c.id);
        if (map && map.size) return [...map.values()].at(-1);
        const emb = c.messages?.at(-1)?.message;
        return emb || null;
      };
      const tsOf = (c) => {
        const lm = lastMsgOf(c);
        return (
          Number(c.conversationTimestamp || 0) ||
          Number(lm?.messageTimestamp || 0) ||
          Number(c.lastMessageRecvTimestamp || 0) ||
          0
        );
      };
      const arr = [...store.chats.values()].sort((a, b) => tsOf(b) - tsOf(a));
      return arr.slice(0, limit).map((c) => {
        const lm = lastMsgOf(c);
        return {
          jid: c.id,
          name: store.nameFor(c.id),
          isGroup: c.id.endsWith("@g.us"),
          unread: c.unreadCount || 0,
          lastTs: tsOf(c),
          lastDate: tsOf(c) ? new Date(tsOf(c) * 1000).toISOString() : null,
          lastMsg: lm ? msgText(lm).slice(0, 80) : "",
        };
      });
    },

    async readMessages(jid, { limit = 30 } = {}) {
      const map = store.messages.get(jid);
      const list = map ? [...map.values()] : [];
      return list.slice(-limit).map((m) => ({
        id: m.key.id,
        fromMe: !!m.key.fromMe,
        sender: m.key.participant || m.key.remoteJid,
        ts: Number(m.messageTimestamp || 0),
        text: msgText(m),
        hasMedia: !!(
          m.message?.imageMessage ||
          m.message?.videoMessage ||
          m.message?.audioMessage ||
          m.message?.documentMessage
        ),
      }));
    },

    async sendText(jid, text) {
      const r = await sock.sendMessage(jid, { text });
      return { id: r.key.id, jid };
    },

    async reply(jid, msgId, text) {
      const quoted = store.messages.get(jid)?.get(msgId);
      if (!quoted) throw new Error(`mensaje ${msgId} no esta en el store de ${jid}`);
      const r = await sock.sendMessage(jid, { text }, { quoted });
      return { id: r.key.id, jid };
    },

    async react(jid, msgId, emoji) {
      const target = store.messages.get(jid)?.get(msgId);
      const key = target?.key || { remoteJid: jid, id: msgId, fromMe: false };
      await sock.sendMessage(jid, { react: { text: emoji, key } });
      return { ok: true };
    },

    async markRead(jid, msgId) {
      const target = store.messages.get(jid)?.get(msgId);
      if (target) await sock.readMessages([target.key]);
      return { ok: true };
    },

    async exportChat(jid, { limit = 500 } = {}) {
      const map = store.messages.get(jid);
      const list = map ? [...map.values()] : [];
      return list.slice(-limit).map((m) => ({
        id: m.key.id,
        fromMe: !!m.key.fromMe,
        sender: store.nameFor(m.key.participant || m.key.remoteJid),
        ts: Number(m.messageTimestamp || 0),
        iso: new Date(Number(m.messageTimestamp || 0) * 1000).toISOString(),
        text: msgText(m),
      }));
    },

    async downloadMedia(jid, msgId, outPath) {
      const m = store.messages.get(jid)?.get(msgId);
      if (!m) throw new Error(`mensaje ${msgId} no esta en el store`);
      const buffer = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const fs = await import("node:fs/promises");
      await fs.writeFile(outPath, buffer);
      return { path: outPath, bytes: buffer.length };
    },

    resolveJid(input) {
      // acepta jid completo o numero suelto
      if (input.includes("@")) return input;
      const digits = input.replace(/[^0-9]/g, "");
      return jidNormalizedUser(digits + "@s.whatsapp.net");
    },

    async syncContacts() {
      // pide a WhatsApp reenviar la libreta (app-state sync) -> dispara
      // contacts.update/upsert que pueblan name/notify en el store.
      try {
        const before = [...store.contacts.values()].filter((c) => c.name || c.notify).length;
        await sock.resyncAppState(
          ["critical_unblock_low", "regular_high", "regular_low", "regular"],
          true
        );
        // dar un momento a que lleguen los eventos
        await new Promise((r) => setTimeout(r, 2500));
        store.save();
        const after = [...store.contacts.values()].filter((c) => c.name || c.notify).length;
        return { total: store.contacts.size, named_before: before, named_after: after };
      } catch (e) {
        return { error: e.message };
      }
    },

    listContacts({ named = false } = {}) {
      const out = [...store.contacts.values()].map((c) => ({
        jid: c.id,
        name: c.name || c.notify || null,
        phone: c.phone || null,
      }));
      return named ? out.filter((c) => c.name) : out;
    },
  };

  return api;
}
