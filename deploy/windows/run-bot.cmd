@echo off
rem Runs the bot forever on Windows, restarting it 30 s after any exit.
rem Started hidden at logon by the "BNB Snipping Bot" scheduled task (install-autostart.cmd).
cd /d "%~dp0\..\.."
if not exist data mkdir data
if exist dataSTOP del dataSTOP
:loop
for %%A in (data\bot.log) do if %%~zA GTR 20000000 move /y data\bot.log data\bot.log.1 >nul
echo {"msg":"wrapper_start","t":"%date% %time%"}>> data\bot.log
node --env-file-if-exists=.env --disable-warning=ExperimentalWarning --import tsx src\main.ts >> data\bot.log 2>&1
echo {"msg":"wrapper_exit","code":%errorlevel%,"t":"%date% %time%"}>> data\bot.log
if exist data\STOP goto end
timeout /t 30 /nobreak >nul
goto loop
:end
del data\STOP
