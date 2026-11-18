@echo off
rem Stops the background bot. It starts again at next logon unless you run uninstall-autostart.cmd.
cd /d "%~dp0\..\.."
if not exist data mkdir data
type nul > data\STOP
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*src*main.ts*') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*run-bot.cmd*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
if exist data\STOP del data\STOP
echo Bot stopped.
