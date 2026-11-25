@echo off
setlocal
rem One-click demo: API server with the simulated wearers + command portal, reachable from phones
rem on the same Wi-Fi. Double-click this file, or run it from a terminal.
cd /d "%~dp0"

rem Use the installed Node.js if it works; otherwise the portable copy in D:\dev-tools.
set "PORTABLE_NODE=D:\dev-tools\node\node-v24.22.3-win-x64"
node -e "process.exit(0)" >nul 2>&1
if errorlevel 1 (
  if exist "%PORTABLE_NODE%\node.exe" (
    set "PATH=%PORTABLE_NODE%;%PATH%"
    echo Installed Node.js is not working - using the portable copy in %PORTABLE_NODE%
  ) else (
    echo Node.js is not working on this PC. Install the LTS version from https://nodejs.org and run this again.
    pause
    exit /b 1
  )
)

echo.
echo  Phone app - type this server address on the activation screen (or Profile - Server):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo      %%b:4000
echo.
echo  Command portal on a phone or another PC:  http://[same address]:3001   (login gov_admin / GovAdmin@123)
echo  If Windows Firewall asks about Node.js, click "Allow" for private networks.
echo  On college Wi-Fi that blocks devices from seeing each other, use your phone's hotspot instead.
echo.

start "Smart Tourist API (port 4000)" /D "%~dp0smart-tourist-server" cmd /k npm run demo
start "Smart Tourist Portal (port 3001)" /D "%~dp0smart-tourist-portal" cmd /k npm run phone
echo  Two windows opened. Close them to stop the demo.
pause
