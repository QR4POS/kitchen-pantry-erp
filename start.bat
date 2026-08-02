@echo off
setlocal
title Kitchen Pantry ERP System
cls
echo ============================================
echo    Kitchen Pantry ERP System
echo    Next.js server + WhatsApp AI worker
echo ============================================
echo.
cd /d "%~dp0"

REM ---------------------------------------------------------------
echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo    [ERROR] Node.js was not found. Install it from https://nodejs.org
    echo           and make sure it is on your PATH, then run this file again.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo    Node.js %NODE_VERSION% found.
echo.

REM ---------------------------------------------------------------
echo [2/5] Checking dependencies...
if not exist "node_modules" (
    echo    node_modules missing - installing dependencies, this can take a while...
    call npm install --no-fund --no-audit
    if errorlevel 1 (
        echo    [ERROR] npm install failed. Check the error above.
        pause
        exit /b 1
    )
) else (
    echo    node_modules present, skipping install.
)
echo.

REM ---------------------------------------------------------------
echo [3/5] Checking Playwright browser (for the WhatsApp worker)...
call npx playwright install chromium 2>nul
echo.
echo    Making sure .env.local exists...
if not exist ".env.local" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env.local" >nul
        echo    Created .env.local from .env.example.
        echo    IMPORTANT: open .env.local and fill in your Supabase and API keys.
    ) else (
        echo    WARNING: no .env.local or .env.example found.
    )
)
echo.

echo    Checking environment variables (.env.local)...
set "MISSING_CORE="
findstr /C:"NEXT_PUBLIC_SUPABASE_URL=" ".env.local" >nul 2>&1 || set "MISSING_CORE=%MISSING_CORE% NEXT_PUBLIC_SUPABASE_URL"
findstr /C:"NEXT_PUBLIC_SUPABASE_ANON_KEY=" ".env.local" >nul 2>&1 || set "MISSING_CORE=%MISSING_CORE% NEXT_PUBLIC_SUPABASE_ANON_KEY"
findstr /C:"SUPABASE_SERVICE_ROLE_KEY=" ".env.local" >nul 2>&1 || set "MISSING_CORE=%MISSING_CORE% SUPABASE_SERVICE_ROLE_KEY"

set "MISSING_AGENT="
findstr /C:"GEMINI_API_KEY=" ".env.local" >nul 2>&1 || set "MISSING_AGENT=%MISSING_AGENT% GEMINI_API_KEY"
findstr /C:"DEEPSEEK_API_KEY=" ".env.local" >nul 2>&1 || set "MISSING_AGENT=%MISSING_AGENT% DEEPSEEK_API_KEY"
findstr /C:"WHATSAPP_WORKER_SECRET=" ".env.local" >nul 2>&1 || set "MISSING_AGENT=%MISSING_AGENT% WHATSAPP_WORKER_SECRET"
findstr /C:"NEXT_PUBLIC_SITE_URL=" ".env.local" >nul 2>&1 || set "MISSING_AGENT=%MISSING_AGENT% NEXT_PUBLIC_SITE_URL"

if not defined MISSING_CORE (
    echo    Core variables OK.
) else (
    echo    WARNING: Missing core variables:%MISSING_CORE%
    echo    The app cannot connect to Supabase until these are set.
)
if not defined MISSING_AGENT (
    echo    AI WhatsApp Agent variables OK.
) else (
    echo    WARNING: Missing AI agent variables:%MISSING_AGENT%
    echo    The AI WhatsApp Sales Agent will not work until these are set.
)
echo.

REM ---------------------------------------------------------------
echo [4/5] Checking port 3000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('    A previous server is still running on port 3000 (PID ' + $_.OwningProcess + '). Stopping it so the new server can start...'); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
ping -n 3 127.0.0.1 >nul
echo.

REM ---------------------------------------------------------------
echo ============================================
echo    Server  : http://localhost:3000
echo    Login   : http://localhost:3000/login
echo.
echo    Admin   - admin@kitchenpantry.com
echo    Password: Admin@123
echo.
echo    Customer- customer@test.com
echo    Password: Customer@123
echo.
echo    AI Agent: http://localhost:3000/admin/settings/ai-agent
echo    Leads   : http://localhost:3000/admin/leads
echo.
echo    Press Ctrl+C in this window to stop the server
echo ============================================
echo.

REM ---------------------------------------------------------------
echo [5/5] Starting the WhatsApp AI worker in a separate window...
echo.
echo    Debug mode logs every DOM direction decision.
echo    Enable it when troubleshooting the worker (loop / detection).
set "DEBUG_MODE="
set /p "DEBUG_MODE=    Enable WHATSAPP_DEBUG? (y/N): " <nul 2>nul || set "DEBUG_MODE=N"
if /i "%DEBUG_MODE%"=="y" (
    echo    -> Worker starting with WHATSAPP_DEBUG=1
    start "WhatsApp Worker" cmd /k "cd /d ""%~dp0"" && ping -n 6 127.0.0.1 >nul && set WHATSAPP_DEBUG=1 && npm run whatsapp-worker"
) else (
    echo    -> Worker starting (normal mode)
    echo       Set WHATSAPP_DEBUG=1 in .env.local for persistent debug logging.
    start "WhatsApp Worker" cmd /k "cd /d ""%~dp0"" && ping -n 6 127.0.0.1 >nul && npm run whatsapp-worker"
)
echo    First run: scan the WhatsApp Web QR code in the worker window.
echo    If you do not need the worker, just close its window.
echo    Logs: storage\whatsapp-worker.log  (when started via Admin)
echo          storage\whatsapp-last-messages.json (dedup state + outgoing evidence)
echo          console output (this worker window)
echo    Debug: set WHATSAPP_DEBUG=1 in .env.local OR answer 'y' above.
echo           set WHATSAPP_PERF=1  in .env.local for performance timings.
echo.

echo Starting the Next.js server, opening the website automatically...
echo.
REM Open the browser as soon as the server is ready (background poller)
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{$r=Invoke-WebRequest -Uri 'http://localhost:3000/login' -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){Start-Process 'http://localhost:3000/login';break}}catch{Start-Sleep -Seconds 2}}"

npx next dev --port 3000
echo.
echo Server stopped.
pause
