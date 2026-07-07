Set-Location "C:\Projects\AutoUpdateDashboard"
git add -A
git status
git commit -m "feat: initial VAU Dashboard - Express/React/SQLite monitoring dashboard"
git push origin main
Write-Host "`nDone! Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
