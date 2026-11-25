@echo off
setlocal DisableDelayedExpansion
"%~dp0node\node.exe" "%~dp0dsh-offline.mjs" %*
exit /b %errorlevel%
