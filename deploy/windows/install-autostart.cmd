@echo off
rem Starts the bot hidden whenever you log on (shortcut in your Startup folder,
rem no admin rights needed), then starts it now. Remove with uninstall-autostart.cmd.
set "RUNNER=%~dp0run-bot.cmd"
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\BNB Snipping Bot.lnk'); $s.TargetPath = \"$env:WINDIR\System32\conhost.exe\"; $s.Arguments = '--headless cmd.exe /c \"%RUNNER%\"'; $s.WindowStyle = 7; $s.Description = 'BNB Snipping bot (paper mode)'; $s.Save()" || exit /b 1
call "%~dp0start-bot.cmd"
