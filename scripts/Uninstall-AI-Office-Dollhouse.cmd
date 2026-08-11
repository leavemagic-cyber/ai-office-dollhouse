@echo off
setlocal
cd /d "%TEMP%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-AI-Office-Dollhouse.ps1"
if errorlevel 1 pause

