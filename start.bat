@echo off
setlocal
echo === FFCS OS Local Launcher (Windows) ===

rem Select a real interpreter via PowerShell, ignoring the WindowsApps alias.
set "PYTHON_BIN="
for /f "delims=" %%I in ('powershell -NoProfile -Command "$p=(Get-Command python -ErrorAction SilentlyContinue).Source; if($p -and $p -notmatch 'WindowsApps'){ $p }" 2^>nul') do set "PYTHON_BIN=%%I"
if not defined PYTHON_BIN (
  for /f "delims=" %%I in ('powershell -NoProfile -Command "$p=(Get-Command python3 -ErrorAction SilentlyContinue).Source; if($p -and $p -notmatch 'WindowsApps'){ $p }" 2^>nul') do set "PYTHON_BIN=%%I"
)
if not defined PYTHON_BIN (
  for /f "delims=" %%I in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_BIN=%%I"
)
if not defined PYTHON_BIN (
  echo ERROR: No working Python interpreter found. Install Python 3.10+ and add it to PATH.
  exit /b 1
)

"%PYTHON_BIN%" -c "import sys; print('Python '+sys.version.split()[0]+' | '+sys.executable)" || (
  echo ERROR: The selected Python interpreter failed its version check: "%PYTHON_BIN%"
  exit /b 1
)
echo Selected Python: %PYTHON_BIN%
"%PYTHON_BIN%" -c "import ortools, pydantic" >nul 2>&1 || (
  echo ERROR: Python dependencies are missing. Run: "%PYTHON_BIN%" -m pip install ortools pydantic
  exit /b 1
)
where.exe node >nul 2>&1 || (
  echo ERROR: Node.js was not found on PATH.
  exit /b 1
)
where.exe npm >nul 2>&1 || (
  echo ERROR: npm was not found on PATH. Install Node.js with npm to build the frontend.
  exit /b 1
)
set "VITE_API_BASE_URL=http://localhost:8080/api"
pushd "%~dp0api-server"
if not exist "node_modules\express\package.json" (
  echo ERROR: API dependencies are missing. Run "npm ci" in the api-server directory.
  popd
  exit /b 1
)
call npm run build || (
  echo ERROR: API production build failed.
  popd
  exit /b 1
)
popd
pushd "%~dp0frontend"
if not exist "node_modules\.bin\vite.cmd" (
  echo ERROR: Frontend dependencies are missing. Run "npm install" in the frontend directory.
  popd
  exit /b 1
)
call npm run build || (
  echo ERROR: Frontend production build failed.
  popd
  exit /b 1
)
popd
set "WORKSPACE_ROOT=%~dp0"
set "PORT=8080"
set "NODE_ENV=production"
set "CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173"
start "FFCS-API" /min node --enable-source-maps "%~dp0api-server\dist\index.mjs"
start "FFCS-Frontend" /min node "%~dp0scripts\serve-frontend.mjs" "%~dp0frontend\dist" 3000
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
echo.
echo FFCS OS is ready!
echo   Frontend ^> http://localhost:3000
echo   API      ^> http://localhost:8080/api
echo.
endlocal
