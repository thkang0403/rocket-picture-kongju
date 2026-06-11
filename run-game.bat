@echo off
setlocal

cd /d "%~dp0"

set "NODE_EXE="
set "NPM_CMD="

for %%P in ("%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe" "%LocalAppData%\Programs\nodejs\node.exe" "%UserProfile%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe") do (
  if not defined NODE_EXE (
    if exist "%%~P" set "NODE_EXE=%%~P"
  )
)

if not defined NODE_EXE (
  for /f "delims=" %%P in ('where node.exe 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%P"
  )
)

for %%P in ("%ProgramFiles%\nodejs\npm.cmd" "%ProgramFiles(x86)%\nodejs\npm.cmd" "%LocalAppData%\Programs\nodejs\npm.cmd") do (
  if not defined NPM_CMD (
    if exist "%%~P" set "NPM_CMD=%%~P"
  )
)

if not defined NPM_CMD (
  for /f "delims=" %%P in ('where npm.cmd 2^>nul') do (
    if not defined NPM_CMD set "NPM_CMD=%%P"
  )
)

if not defined NODE_EXE (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  if not defined NPM_CMD (
    echo node_modules is missing and npm was not found.
    echo Install Node.js LTS from https://nodejs.org/ and run this file again.
    pause
    exit /b 1
  )

  echo Installing dependencies. This can take a minute the first time...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /PID %%P /F >nul 2>nul
)

echo Starting local multiplayer server...
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-server.ps1"

echo Waiting for the server to become ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='http://localhost:3000'; for($i=0; $i -lt 60; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if($r.StatusCode -ge 200){ Start-Process $url; exit 0 } } catch { Start-Sleep -Milliseconds 500 } }; Start-Process $url"

exit /b 0
