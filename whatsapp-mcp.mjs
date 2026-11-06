// whatsapp-mcp.mjs - MCP server stdio sobre Baileys.
// Registrar en ~/.pi/agent/mcp.json como server "whatsapp".
// Requiere haber corrido antes: node wa-login.mjs  (vinculacion por QR).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWA } from "./wa-core.mjs";

const wa = await createWA({ printQR: false });

// no bloquear el arranque del server por la conexion; se resuelve en bg
wa.waitConnected(60000)
  .then(() => console.error("[whatsapp-mcp] conectado a WhatsApp"))
  .catch(() => {});

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fail(msg) {
  return { content: [{ type: "text", text: JSON.stringify({ error: String(msg) }) }], isError: true };
}
async function guard() {
  if (wa.isConnected()) return;
  try {
    await wa.waitConnected(20000);
  } catch {
    throw new Error("WhatsApp no conectado (timeout). Si se desvinculo, corre `node wa-login.mjs` para re-vincular por QR.");
  }
}

const server = new McpServer({ name: "whatsapp", version: "0.1.0" });

server.registerTool(
  "status",
  { title: "Estado de conexion", description: "Indica si el cliente WhatsApp esta conectado.", inputSchema: {} },
  async () => ok({ connected: wa.isConnected(), chats: wa.store.chats.size, contacts: wa.store.contacts.size })
);

server.registerTool(
  "sync_names",
  {
    title: "Sincronizar nombres de grupos",
    description: "Trae el nombre real (subject) de todos los grupos. Los nombres de chats 1:1 se pueblan solos cuando llega un mensaje nuevo (pushName).",
    inputSchema: {},
  },
  async () => {
    try { await guard(); return ok(await wa.syncGroupNames()); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "sync_contacts",
  {
    title: "Sincronizar libreta de contactos",
    description: "Pide a WhatsApp reenviar tu agenda (app-state sync) para poblar los nombres guardados de los contactos 1:1. Devuelve cuantos quedaron con nombre.",
    inputSchema: {},
  },
  async () => {
    try { await guard(); return ok(await wa.syncContacts()); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "list_contacts",
  {
    title: "Listar contactos",
    description: "Lista los contactos del store (jid, nombre, telefono). named:true devuelve solo los que ya tienen nombre.",
    inputSchema: { named: z.boolean().optional().describe("solo contactos con nombre (def false)") },
  },
  async ({ named }) => {
    try { await guard(); return ok(wa.listContacts({ named: named ?? false })); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "list_chats",
  {
    title: "Listar chats",
    description: "Lista los chats mas recientes (jid, nombre, no leidos, timestamp).",
    inputSchema: { limit: z.number().optional().describe("max chats (def 30)") },
  },
  async ({ limit }) => {
    try { await guard(); return ok(await wa.listChats({ limit: limit ?? 30 })); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "read_chat",
  {
    title: "Leer mensajes de un chat",
    description: "Devuelve los ultimos mensajes de un chat. 'chat' acepta jid completo o numero.",
    inputSchema: {
      chat: z.string().describe("jid (xxx@s.whatsapp.net / @g.us) o numero"),
      limit: z.number().optional().describe("max mensajes (def 30)"),
    },
  },
  async ({ chat, limit }) => {
    try { await guard(); const jid = wa.resolveJid(chat); return ok(await wa.readMessages(jid, { limit: limit ?? 30 })); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "send_message",
  {
    title: "Enviar mensaje",
    description: "Envia un mensaje de texto a un chat (jid o numero).",
    inputSchema: { chat: z.string(), text: z.string() },
  },
  async ({ chat, text }) => {
    try { await guard(); return ok(await wa.sendText(wa.resolveJid(chat), text)); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "reply_message",
  {
    title: "Responder a un mensaje (quoted)",
    description: "Responde citando un mensaje existente. message_id debe estar en el store (leer el chat primero).",
    inputSchema: { chat: z.string(), message_id: z.string(), text: z.string() },
  },
  async ({ chat, message_id, text }) => {
    try { await guard(); return ok(await wa.reply(wa.resolveJid(chat), message_id, text)); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "react_message",
  {
    title: "Reaccionar a un mensaje",
    description: "Agrega una reaccion emoji a un mensaje. emoji vacio ('') quita la reaccion.",
    inputSchema: { chat: z.string(), message_id: z.string(), emoji: z.string() },
  },
  async ({ chat, message_id, emoji }) => {
    try { await guard(); return ok(await wa.react(wa.resolveJid(chat), message_id, emoji)); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "mark_read",
  {
    title: "Marcar como leido",
    description: "Marca un mensaje (y el chat) como leido.",
    inputSchema: { chat: z.string(), message_id: z.string() },
  },
  async ({ chat, message_id }) => {
    try { await guard(); return ok(await wa.markRead(wa.resolveJid(chat), message_id)); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "export_chat",
  {
    title: "Exportar chat",
    description: "Exporta los mensajes de un chat como JSON (con fecha ISO y nombre de remitente).",
    inputSchema: { chat: z.string(), limit: z.number().optional().describe("max mensajes (def 500)") },
  },
  async ({ chat, limit }) => {
    try { await guard(); return ok(await wa.exportChat(wa.resolveJid(chat), { limit: limit ?? 500 })); }
    catch (e) { return fail(e.message); }
  }
);

server.registerTool(
  "download_media",
  {
    title: "Descargar media de un mensaje",
    description: "Descarga el adjunto (imagen/video/audio/doc) de un mensaje a un archivo local.",
    inputSchema: { chat: z.string(), message_id: z.string(), out_path: z.string().describe("ruta destino del archivo") },
  },
  async ({ chat, message_id, out_path }) => {
    try { await guard(); return ok(await wa.downloadMedia(wa.resolveJid(chat), message_id, out_path)); }
    catch (e) { return fail(e.message); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[whatsapp-mcp] server listo (stdio)");
