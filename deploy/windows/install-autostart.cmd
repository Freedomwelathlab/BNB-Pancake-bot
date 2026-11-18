@echo off
rem Registers a per-user scheduled task that starts the bot hidden when you log on,
rem then starts it now. No admin rights needed. Remove with uninstall-autostart.cmd.
set "RUNNER=%~dp0run-bot.cmd"
schtasks /Create /F /TN "BNB Snipping Bot" /SC ONLOGON /RL LIMITED /TR "conhost.exe --headless cmd.exe /c \"%RUNNER%\"" || exit /b 1
powershell -NoProfile -Command "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -MultipleInstances IgnoreNew; Set-ScheduledTask -TaskName 'BNB Snipping Bot' -Settings $s | Out-Null"
schtasks /Run /TN "BNB Snipping Bot"
echo Bot started in the background. Dashboard: http://127.0.0.1:8787  Log: data\bot.log
