# WhatsPike — control de tu PC por WhatsApp

Habla (texto o voz) con tu propia PC desde tu self-chat de WhatsApp. Un asistente de IA
hace el trabajo en tu máquina: crea/edita archivos, corre comandos, **ve la pantalla**,
controla mouse/teclado, abre apps, graba video, y te responde corto.

Usa un dispositivo WhatsApp propio (Baileys multi-device) → coexiste con otros bots.
Voz transcrita **local** (faster-whisper, offline). Sesiones de IA costo 0 (Claude CLI).

## Correr
```bash
npm install
node bridge-login.mjs   # 1 sola vez: escanea el QR con WhatsApp
node pike-bridge.mjs     # arranca el puente (o: bash start-bridge.sh)
```

## Uso (en tu self-chat de WhatsApp)
Escribe en lenguaje natural:
- *muéstrame la pantalla* · *abre el navegador y entra a gmail* · *graba 10 segundos*
- *crea un archivo notas.txt* · `/help` para atajos

### Sesiones (contextos independientes)
`@nombre <msg>` · `/new <nombre>` · `/use <n>` · `/sessions`

### Pausar/reanudar (control LOCAL, desde la PC)
- `PAUSAR-pike.bat` / `REANUDAR-pike.bat` (doble clic) — o `bash pike-pause.sh` / `bash pike-resume.sh`
- Crea/borra el flag `PAUSED.flag`; el bridge sigue conectado, solo deja de procesar.

## Archivos
- `pike-bridge.mjs` — el puente (listener WhatsApp ↔ sesiones de IA + GUI)
- `wa-core.mjs` — conexión Baileys
- `stt_server.py` / `gui_server.py` — voz→texto y control de pantalla
- `wa-send.mjs` — la IA te envía archivos/imágenes/video
- `whatsapp-mcp.mjs` — servidor MCP de WhatsApp (uso aparte)

## Seguridad
`auth*/`, `store*.json`, `sessions.json` contienen credenciales y tus mensajes — están
en `.gitignore` y **nunca** se publican.

MIT · [balmacefa](https://balmacefa.com)
