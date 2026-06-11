@echo off
setlocal

cd /d "%~dp0"

set "NODE_EXE="

if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE for /f "delims=" %%P in ('where node.exe 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%P"
)

if not defined NODE_EXE (
  echo Node.js was not found. >> "launcher.log"
  exit /b 1
)

"%NODE_EXE%" "server\server.js" >> "launcher.log" 2>&1
