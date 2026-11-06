@echo off
setlocal enabledelayedexpansion

set "DIR=%~dp0.."
set "DSH_HOME=%DIR%\data"
if "%PORT%"=="" set "PORT=3080"
if "%HOST%"=="" set "HOST=0.0.0.0"
set "NODE_ENV=production"

echo ========================================================
echo   BiSheng / DeepSeek Harness Web Service (Windows)
echo ========================================================
echo   Root:      %DIR%
echo   Data:      %DSH_HOME%
echo   URL:       http://localhost:%PORT%
echo ========================================================

:: 1. 检查 Node.js 环境
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 Node.js，请先安装 Node.js (推荐 20+ 或 22+)
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 2. 确保数据目录与 Web Profile 初始化
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%"
if not exist "%DSH_HOME%\profiles\web" (
    echo [INFO] 正在初始化 Web Profile 配置...
    mkdir "%DSH_HOME%\profiles\web"
    if exist "%DIR%\profile\package.json" copy /y "%DIR%\profile\package.json" "%DSH_HOME%\profiles\web\package.json" >nul
    if exist "%DIR%\profile\cordis.yml" copy /y "%DIR%\profile\cordis.yml" "%DSH_HOME%\profiles\web\cordis.yml" >nul
)

:: 3. 寻找 Harness 启动入口
set "HARNESS_ENTRY="
if exist "%DIR%\core\apps\cli\lib\bin.js" (
    set "HARNESS_ENTRY=%DIR%\core\apps\cli\lib\bin.js"
    cd /d "%DIR%\core"
    node "!HARNESS_ENTRY!" web --port %PORT% --host %HOST% --no-open
) else if exist "%DIR%\core\apps\cli\src\bin.ts" (
    cd /d "%DIR%\core"
    npx tsx apps\cli\src\bin.ts web --port %PORT% --host %HOST% --no-open
) else if exist "%DIR%\..\deepseek-harness\apps\cli\src\bin.ts" (
    echo [INFO] 使用同级 deepseek-harness 源码启动...
    cd /d "%DIR%\..\deepseek-harness"
    npx tsx apps\cli\src\bin.ts web --port %PORT% --host %HOST% --no-open
) else (
    echo [ERROR] 未找到 Harness 运行时入口!
    echo 请确认以下任一路径存在:
    echo   1. %DIR%\core\apps\cli\lib\bin.js
    echo   2. %DIR%\core\apps\cli\src\bin.ts
    echo   3. %DIR%\..\deepseek-harness\apps\cli\src\bin.ts
    echo.
    echo 提示: 如果你刚克隆了 deepseek-harness，请确保它位于与本目录同级的 deepseek-harness/ 目录下。
    pause
    exit /b 1
)

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 服务异常退出，退出码: %errorlevel%
    pause
)

endlocal
