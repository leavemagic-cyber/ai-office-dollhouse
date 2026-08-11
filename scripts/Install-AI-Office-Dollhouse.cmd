@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AI-Office-Dollhouse.ps1" -Launch
if errorlevel 1 pause

