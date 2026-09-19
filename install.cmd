@echo off
rem ============================================================================
rem  dsh-extras one-click installer (double-click this file).
rem
rem  Use this the FIRST time on a new machine. Afterwards dsh-tray.ps1 and
rem  launch-dsh-web.cmd run the same installer automatically before every start
rem  (see MAINTAINERS.md), so a manual run is only needed to apply changes now.
rem
rem  This file is intentionally ASCII-only: cmd.exe reads .cmd files in the
rem  system ANSI codepage, so UTF-8 Chinese here would show up as mojibake.
rem  The installer itself (PowerShell, UTF-8 with BOM) prints Chinese fine.
rem ============================================================================
setlocal
set "SCRIPT=%~dp0scripts\install.ps1"

if not exist "%SCRIPT%" (
  echo [FAIL] installer not found: %SCRIPT%
  echo        run this file from inside the dsh-extras folder.
  pause
  exit /b 1
)

echo Running: %SCRIPT%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -SetDefault
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo [FAIL] installer exited with code %CODE% - see the output above.
) else (
  echo [DONE] restart dsh web; the plugin group takes effect after that.
)
pause
exit /b %CODE%