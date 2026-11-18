@echo off
call "%~dp0stop-bot.cmd"
schtasks /Delete /F /TN "BNB Snipping Bot"
echo Autostart removed.
