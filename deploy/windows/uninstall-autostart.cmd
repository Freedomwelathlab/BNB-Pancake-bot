@echo off
call "%~dp0stop-bot.cmd"
powershell -NoProfile -Command "Remove-Item -LiteralPath ([Environment]::GetFolderPath('Startup') + '\BNB Snipping Bot.lnk') -ErrorAction SilentlyContinue"
echo Autostart removed.
