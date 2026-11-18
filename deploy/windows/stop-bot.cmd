@echo off
rem Stops the background bot (it starts again at next logon unless you run uninstall-autostart.cmd).
cd /d "%~dp0\..\.."
if not exist data mkdir data
type nul > data\STOP
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*src\main.ts*' -or $_.CommandLine -like '*src/main.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 3 /nobreak >nul
schtasks /End /TN "BNB Snipping Bot" >nul 2>&1
echo Bot stopped.
