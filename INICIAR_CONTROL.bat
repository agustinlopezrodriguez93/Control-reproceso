@echo off
title Servidor - Control de Reproceso
echo.
echo ===========================================
echo   INICIANDO CONTROL DE REPROCESO SKU
echo ===========================================
echo.
echo No cierres esta ventana mientras uses el sistema.
echo.
echo Redirigiendo al navegador...
start "" "http://localhost:8000"
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
