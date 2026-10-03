@echo off
REM ============================================================
REM  StockFunnel - Cloudflare deployment helper (Windows)
REM  Usage:  deploy.bat  [login|db|init|go|admin|proxy|test]
REM
REM  NOTE: keep this file ASCII-only with CRLF endings.
REM  cmd.exe reads scripts in the OEM codepage; a UTF-8 CJK
REM  character whose trailing byte lands on CR will swallow the
REM  newline and glue the next line onto this one.
REM ============================================================
setlocal
cd /d "%~dp0"

REM ---- proxy -----------------------------------------------------
REM api.cloudflare.com is unreachable directly on some networks.
REM If a local proxy is running, wrangler must be told about it.
REM wrangler reads HTTPS_PROXY / HTTP_PROXY directly, so we only
REM need to export those.  (NODE_OPTIONS=--proxy= is NOT valid:
REM node rejects it with "not allowed in NODE_OPTIONS".)
REM
REM To force a specific proxy:
REM     set SF_PROXY=http://127.0.0.1:7890
REM then run this script again.
if not defined SF_PROXY if defined HTTPS_PROXY set SF_PROXY=%HTTPS_PROXY%
if not defined SF_PROXY (
  for %%P in (10808 7890 7897 10809 1080 33210) do (
    if not defined SF_PROXY (
      powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port %%P -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
      if not errorlevel 1 set SF_PROXY=http://127.0.0.1:%%P
    )
  )
)
if defined SF_PROXY (
  set HTTPS_PROXY=%SF_PROXY%
  set HTTP_PROXY=%SF_PROXY%
)

set CMD_ARG=%~1
if "%CMD_ARG%"=="" set CMD_ARG=help

echo.
echo  ==========================================
echo   StockFunnel  Cloudflare  Deployment
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

if defined SF_PROXY (
  echo  Proxy   : %SF_PROXY%
) else (
  echo  Proxy   : none
)
echo.

call :wver
goto :%CMD_ARG%

REM ============================================================
:nonode
echo  [ERROR] Node.js was not found in PATH.
echo          Install Node.js 18+ from https://nodejs.org
echo          then reopen this window.
pause
exit /b 1

REM ============================================================
:wver
echo  Using wrangler:
call npx --no-install wrangler --version
echo.
exit /b 0

REM ============================================================
:help
echo  Usage:  deploy.bat  command
echo.
echo    test    Check network access to the Cloudflare API
echo    login   Log in to Cloudflare (opens browser)
echo    db      Create the D1 database
echo    init    Create tables in D1
echo    go      Create DB, init tables, then deploy
echo    admin   Create an admin account
echo    pages   Deploy frontend to Cloudflare Pages (China-accessible)
echo    domain  How to bind a custom domain (avoids workers.dev block)
echo    proxy   How to deploy the turnover proxy Worker
echo.
pause
exit /b 0

REM ============================================================
:test
echo  Testing the Cloudflare API ...
echo.
call npx --no-install wrangler whoami
echo.
if errorlevel 1 (
  echo  Could not reach the Cloudflare API.
  echo.
  echo  If a proxy is running, set it first, for example:
  echo      set SF_PROXY=http://127.0.0.1:7890
  echo      deploy.bat test
  echo.
  echo  Or turn on "system proxy" in your proxy client so
  echo  HTTPS_PROXY is exported, then run deploy.bat again.
) else (
  echo  Connected.  If you have not logged in yet, run:
  echo      deploy.bat login
)
echo.
pause
exit /b 0

REM ============================================================
:login
echo  Opening your browser for Cloudflare login.
echo  Approve the request in the tab that opens.
echo.
call npx --no-install wrangler login
echo.
if errorlevel 1 goto :loginfail
echo  Login done.  Next:  deploy.bat db
pause
exit /b 0
:loginfail
echo  Login did not complete. Check the message above.
pause
exit /b 1

REM ============================================================
:db
echo  Creating D1 database named stockfunnel ...
echo.
call npx --no-install wrangler d1 create stockfunnel
echo.
echo  ---------------------------------------------------------------
echo  If this is a NEW database:
echo    1. Copy the database_id printed above
echo    2. Open wrangler.toml
echo    3. Replace REPLACE_WITH_YOUR_D1_ID with that value
echo    4. Run:  deploy.bat init
echo  ---------------------------------------------------------------
pause
exit /b 0

REM ============================================================
:init
echo  Creating tables from schema.sql ...
echo.
call npx --no-install wrangler d1 execute stockfunnel --file=./schema.sql
echo.
echo  Tables are ready.
pause
exit /b 0

REM ============================================================
:go
echo  Step 1 of 3 : create D1 database
echo.
call npx --no-install wrangler d1 create stockfunnel
echo.
echo  -----------------------------------------------------------------
echo  If the database was just created, STOP now:
echo    copy database_id from above into wrangler.toml
echo    replacing REPLACE_WITH_YOUR_D1_ID
echo  Then run:  deploy.bat init
echo  Otherwise continue.
echo  -----------------------------------------------------------------
pause

echo.
echo  Step 2 of 3 : create tables
echo.
call npx --no-install wrangler d1 execute stockfunnel --file=./schema.sql
echo.

echo  Step 3 of 3 : deploy
echo.
call npx --no-install wrangler deploy
echo.
echo  ==========================================
echo   Done.  The URL was printed above.
echo   Open it, log in, then use the account
echo   menu to reach the admin panel.
echo  ==========================================
echo.
pause
exit /b 0

REM ============================================================
:admin
set ADMNAME=
set ADMPASS=
set /p ADMNAME=Admin username (3-20 chars):
set /p ADMPASS=Admin password (min 6 chars):
echo.
echo  Generating ...
echo.
node scripts\create-admin.js %ADMNAME% %ADMPASS%
echo.
set SQLCMD=
set /p SQLCMD=Paste the sql line above, then press Enter:
if "%SQLCMD%"=="" goto :adminempty
call npx --no-install wrangler d1 execute stockfunnel --command "%SQLCMD%"
echo.
echo  Admin account ready.  Log in with %ADMNAME%
pause
exit /b 0
:adminempty
echo  No SQL entered.  Nothing was changed.
pause
exit /b 1

REM ============================================================
:pages
echo  Deploying frontend to Cloudflare Pages (China-accessible) ...
echo.
echo  Why Pages: workers.dev is blocked in mainland China,
echo  but pages.dev is reachable. Users only talk to pages.dev;
echo  the /api/* edge proxy forwards to the Worker.
echo.
echo  Step 1: build static assets into public/
call node scripts\build-assets.js
if errorlevel 1 (
  echo  Build failed. Fix and retry.
  pause
  exit /b 1
)
echo.
echo  Step 2: create the Pages project (skip if it exists)
call npx --no-install wrangler pages project create stockfunnel --production-branch main
echo.
echo  Step 3: deploy
call npx --no-install wrangler pages deploy public --project-name stockfunnel --branch main
echo.
echo  ==========================================
echo   Frontend live at:
echo     https://stockfunnel.pages.dev
echo  ==========================================
echo.
pause
exit /b 0

REM ============================================================
:domain
echo  ==============================================================
echo   Custom Domain
echo  ==============================================================
echo.
echo  The default *.workers.dev address is DNS-polluted in
echo  mainland China and needs a VPN to open.
echo  Bind a custom domain to avoid that. No ICP filing is
echo  needed when the zone is hosted on Cloudflare.
echo.
echo  Steps:
echo    1. Have a domain whose nameservers point to Cloudflare
echo       (Dashboard - Websites - Add a site, then update NS)
echo    2. Workers ^& Pages - stockfunnel
echo         - Settings - Domains ^& Routes - Add - Custom domain
echo    3. Enter e.g.  app.yourdomain.com
echo    4. Cloudflare handles DNS and the TLS certificate
echo.
echo  After binding, wrangler.toml can pin the route:
echo    [[routes]]
echo    pattern = "app.yourdomain.com"
echo    custom_domain = true
echo.
echo  Current address:
echo    https://stockfunnel.kongchris655.workers.dev
echo.
pause
exit /b 0

REM ============================================================
:proxy
echo  ==============================================================
echo   Turnover Proxy Worker   (optional, improves accuracy)
echo  ==============================================================
echo.
echo  The chip distribution model needs daily turnover rates.
echo  Source q.stock.sohu.com does not send CORS headers, so
echo  the browser cannot fetch it directly.
echo.
echo  Deploy it like this:
echo    1. Cloudflare Dashboard
echo       Workers and Pages  -  Create  -  Worker
echo    2. Paste the content of   workers\proxy.js
echo    3. Click Deploy
echo    4. In the app open  Funnel - Settings - Turnover source
echo         and enter  https://your-worker.workers.dev/?url=
echo.
echo  The app still works without it.  The chip layer then
echo  falls back to estimation with lower precision.
echo.
pause
exit /b 0
