@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
echo Starting NoFollow Web... (a browser tab opens; press Ctrl+C here to stop cleanly)
node unfollow.mjs
pause
