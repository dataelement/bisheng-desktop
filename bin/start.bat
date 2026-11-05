@echo off
setlocal

set "DIR=%~dp0.."
set "DSH_HOME=%DIR%\data"
if "%PORT%"=="" set "PORT=3080"
if "%HOST%"=="" set "HOST=0.0.0.0"
set "NODE_ENV=production"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found. Please install Node.js (>=20.0.0).
    pause
    exit /b 1
)

if not exist "%DSH_HOME%" mkdir "%DSH_HOME%"

echo ==========================================
echo Starting BiSheng Web Service...
echo Root: %DIR%
echo URL: http://%HOST%:%PORT%
echo Data: %DSH_HOME%
echo ==========================================

if exist "%DIR%\core\apps\cli\bin.js" (
    cd /d "%DIR%\core"
    node apps\cli\bin.js web --port %PORT% --host %HOST% --no-open
) else if exist "%DIR%\core\node_modules\@deepseek-ai\dsh\lib\bin.js" (
    cd /d "%DIR%\core"
    node node_modules\@deepseek-ai\dsh\lib\bin.js web --port %PORT% --host %HOST% --no-open
) else if exist "%DIR%\..\deepseek-harness" (
    cd /d "%DIR%\..\deepseek-harness"
    node --import tsx/esm apps\cli\src\bin.ts web --port %PORT% --host %HOST% --no-open
) else (
    echo [ERROR] Harness runtime entry not found.
    pause
    exit /b 1
)

endlocal
