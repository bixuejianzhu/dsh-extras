@echo off
rem ============================================================================
rem  dsh-extras one-click installer (double-click this file).
rem
rem  Use this the FIRST time on a new machine, or any time you want to re-apply
rem  the wiring without opening the GUI. After the plugin group is mounted, the
rem  same thing is available as a button in Settings -> "通用插件设置".
rem
rem  Why a .cmd and not only the in-GUI button: the button lives inside the
rem  plugin group, so it cannot exist before the group is mounted (chicken and
rem  egg). This file is the bootstrap half.
rem
rem  This file is intentionally ASCII-only: cmd.exe reads .cmd files in the
rem  system ANSI codepage, so UTF-8 Chinese here would print as mojibake. The
rem  installer itself (PowerShell, UTF-8 with BOM) prints Chinese just fine.
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
  echo [DONE] now restart dsh web; the settings page "通用插件设置" appears afterwards.
)
pause
exit /b %CODE%
