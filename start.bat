@echo off
rem Starts a local web server for the game and opens it in the browser.
rem The game uses JavaScript modules, which browsers won't load straight from disk.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/ and tick "Add python.exe to PATH".
  echo Python bulunamadi. https://www.python.org/ adresinden kurun ve "Add python.exe to PATH" kutusunu isaretleyin.
  pause
  exit /b 1
)

rem open the browser a moment after the server starts
start "" /b cmd /c "timeout /t 1 /nobreak >nul && start http://localhost:8016"
python serve.py 8016
if errorlevel 1 pause
