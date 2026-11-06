// wa-login.mjs - escanear QR UNA vez para vincular el dispositivo.
// Uso: node wa-login.mjs   (abri WhatsApp movil > Dispositivos vinculados > Vincular)
import qrcode from "qrcode-terminal";
import { createWA } from "./wa-core.mjs";

const wa = await createWA({ printQR: false });

let lastShown = null;
const iv = setInterval(() => {
  const qr = wa.getQR();
  if (qr && qr !== lastShown) {
    lastShown = qr;
    console.log("\nEscanea este QR con WhatsApp (Dispositivos vinculados):\n");
    qrcode.generate(qr, { small: true });
  }
}, 500);

wa.ready.then(async () => {
  clearInterval(iv);
  console.log("\n✅ Vinculado y conectado. Sincronizando historial...");
  // espera un poco a que llegue messaging-history.set
  await new Promise((r) => setTimeout(r, 8000));
  const chats = await wa.listChats({ limit: 10 });
  console.log(`\nChats recientes (${chats.length}):`);
  for (const c of chats) console.log(`  ${c.name}  <${c.jid}>`);
  console.log("\nCredenciales guardadas en ./auth . Ya podes cerrar (Ctrl+C) y usar el MCP.");
  process.exit(0);
});
