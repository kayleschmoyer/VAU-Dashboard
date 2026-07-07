@echo off
cd /d "C:\Projects\AutoUpdateDashboard"
git add -A
git commit -m "feat: initial VAU Dashboard - Express/React/SQLite monitoring dashboard"
git push origin main
echo.
echo Done! Press any key to close...
pause >nul
