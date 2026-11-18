@echo off
rem Starts the bot in the background now (hidden window, restarts itself on crash).
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*run-bot.cmd*' }) { Write-Output 'Bot is already running.'; exit 1 }" || exit /b 0
start "" "%WINDIR%\System32\conhost.exe" --headless cmd.exe /c "%~dp0run-bot.cmd"
echo Bot started in the background. Dashboard: http://127.0.0.1:8787  Log: data\bot.log
