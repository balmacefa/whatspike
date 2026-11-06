#!/usr/bin/env node
// wa-send.mjs - la sesion de IA usa esto para MOSTRARLE algo al usuario por
// WhatsApp (imagen, video, audio o archivo). Encola el archivo; el bridge lo manda.
// Uso: node wa-send.mjs <ruta> [titulo...]
import fs from "node:fs";
import path from "node:path";

const [, , file, ...rest] = process.argv;
if (!file) { console.error("uso: wa-send <ruta> [titulo]"); process.exit(1); }
const abs = path.resolve(file);
if (!fs.existsSync(abs)) { console.error("no existe: " + abs); process.exit(1); }
const caption = rest.join(" ");
const line = JSON.stringify({ path: abs, caption, ts: Date.now() }) + "\n";
fs.appendFileSync("C:/Users/fabia/whatsapp-mcp/outbox.jsonl", line);
console.log("enviado a WhatsApp: " + path.basename(abs));
