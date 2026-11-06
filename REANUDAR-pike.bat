@echo off
REM Reanuda el puente WhatsApp<->PC. Borra el flag de pausa.
if exist "%~dp0PAUSED.flag" del /q "%~dp0PAUSED.flag"
echo.
echo [#] Pike (WhatsApp) ACTIVO otra vez. Ya responde tus mensajes.
echo.
timeout /t 3 >nul
