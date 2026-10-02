@echo off
REM ============================================================
REM  StockFunnel - Cloudflare deployment helper (Windows)
REM  Run in cmd.exe.  Usage:  deploy.bat
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo   StockFunnel  Cloudflare  Deployment
echo  ==========================================
echo.

REM ---- check node ----
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js not found in PATH.
  echo          Install Node.js 18+ from https://nodejs.org
  pause
  exit /b 1
)

REM ---- use local wrangler ----
set WRANGLER=npx --no-install wrangler
echo  Using wrangler:
%WRANGLER% --version
echo.

if "%~1"=="login" goto :login
if "%~1"=="db"    goto :db
if "%~1"=="init"  goto :init
if "%~1"=="go"    goto :go
if "%~1"=="admin" goto :admin
if "%~1"=="proxy" goto :proxy

echo  Usage:  deploy.bat  ^< command ^>
echo.
echo    login   Login to Cloudflare (opens browser)
echo    db      Create D1 database
echo    init    Create tables in D1
echo    go      Create DB + init tables + deploy  (full flow)
echo    admin   Generate admin account SQL
echo    proxy   Show instructions for the turnover proxy Worker
echo.
pause
exit /b 0

REM ============================================================
:login
echo  [1/1] Opening browser for Cloudflare login...
echo.
%WRANGLER% login
echo.
echo  Done. If a browser tab opened, approve the request there.
pause
exit /b 0

REM ============================================================
:db
echo  Creating D1 database "stockfunnel"...
echo.
%WRANGLER% d1 create stockfunnel
echo.
echo  ------------------------------------------------------------
echo  Copy the database_id from the output above and paste it
echo  into wrangler.toml, replacing REPLACE_WITH_YOUR_D1_ID
echo  ------------------------------------------------------------
pause
exit /b 0

REM ============================================================
:init
echo  Creating tables from schema.sql ...
echo.
%WRANGLER% d1 execute stockfunnel --file=./schema.sql
echo.
echo  Tables created.
pause
exit /b 0

REM ============================================================
:go
echo  This will:
echo    1. create D1 database
echo    2. initialize tables
echo    3. deploy the Worker
echo.
echo  You still need to paste database_id into wrangler.toml
echo  after step 1 if it is a fresh database.
echo.
pause

echo.
echo  === Step 1: create D1 ===
%WRANGLER% d1 create stockfunnel
echo.
echo  !!! If this is a NEW database, stop here, copy database_id
echo  !!! into wrangler.toml, then run:  deploy.bat init
echo.
pause

echo  === Step 2: create tables ===
%WRANGLER% d1 execute stockfunnel --file=./schema.sql
echo.
echo  === Step 3: deploy ===
%WRANGLER% deploy
echo.
echo  ==========================================
echo   Done. Your URL is printed above.
echo  Open it, log in, and go to the account
echo  menu to find the admin panel.
echo  ==========================================
echo.
pause
exit /b 0

REM ============================================================
:admin
set /p UNAME=Enter admin username (3-20 chars): 
set /p PASSW=Enter admin password (min 6 chars): 
echo.
echo  Running generator...
echo.
node scripts\create-admin.js %UNAME% %PASSW%
echo.
echo  Copy the "sql" line above, then paste it below.
echo.
set /p SQL=SQL to execute: 
%WRANGLER% d1 execute stockfunnel --command "!SQL!"
echo.
echo  Admin account created. Log in with: !UNAME!
pause
exit /b 0

REM ============================================================
:proxy
echo  ==========================================================
echo   Turnover Proxy Worker  (optional, improves accuracy)
echo  ==========================================================
echo.
echo  The chip-distribution model needs daily turnover rates.
echo  Source q.stock.sohu.com does NOT send CORS headers,
echo  so the browser cannot reach it directly.
echo.
echo  How to deploy:
echo    1. Open Cloudflare Dashboard
echo       Workers and Pages - Create - Worker
echo    2. Paste the content of:  workers\proxy.js
echo    3. Click Deploy
echo    4. In the app:  Funnel - Settings - Turnover source
echo       enter:  https://your-worker.workers.dev/?url=
echo.
echo  Without it the app still works; the chip layer
echo  falls back to estimation with lower precision.
echo.
pause
exit /b 0
