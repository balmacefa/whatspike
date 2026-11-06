// bridge-login.mjs - vincula el BRIDGE como su propio dispositivo (auth-bridge),
// independiente del MCP. Genera el QR como PNG y lo abre para escanear.
import QRCode from "qrcode";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWA } from "./wa-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.join(__dirname, "auth-bridge");
const STORE = path.join(__dirname, "store-bridge.json");
const QRPNG = path.join(__dirname, "bridge-qr.png");

const wa = await createWA({ authDir: AUTH, storePath: STORE, printQR: false });

let shown = null;
let opened = false;
const iv = setInterval(async () => {
  const qr = wa.getQR();
  if (qr && qr !== shown) {
    shown = qr;
    // archivo unico por QR -> evita el lock del visor al rotar
    const f = path.join(__dirname, `bridge-qr-${Date.now()}.png`);
    try {
      await QRCode.toFile(f, qr, { width: 420, margin: 2 });
      await QRCode.toFile(QRPNG, qr, { width: 420, margin: 2 }).catch(() => {});
      console.error("[login] QR -> " + f);
      if (!opened) {
        opened = true;
        spawn("cmd.exe", ["/c", "start", "", f], { detached: true, stdio: "ignore" }).unref();
      }
    } catch (e) { console.error("[login] qr write skip:", e.code || e.message); }
  }
}, 600);

wa.ready.then(async () => {
  clearInterval(iv);
  console.error("[login] VINCULADO. Sincronizando...");
  await new Promise((r) => setTimeout(r, 6000));
  console.error("[login] listo. Ya podes cerrar y arrancar el bridge.");
  process.exit(0);
});
