@echo off
REM Pausa el puente WhatsApp<->PC (control LOCAL, no manda nada por WhatsApp).
REM Crea el flag que el bridge revisa en cada mensaje -> deja de procesar.
echo pausado > "%~dp0PAUSED.flag"
echo.
echo [#] Pike (WhatsApp) EN PAUSA. No respondera a tus mensajes.
echo     Doble clic en REANUDAR-pike.bat para volver a activarlo.
echo.
timeout /t 3 >nul
