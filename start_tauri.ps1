$SourceFrontendPath = Join-Path $PSScriptRoot "frontend"
$SafeDevRoot = Join-Path $env:LOCALAPPDATA "Sonotext\tauri-dev"
$FrontendPath = Join-Path $SafeDevRoot "frontend"
$TauriCliPath = Join-Path $FrontendPath "node_modules\.bin\tauri.cmd"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Bun is required to start the frontend." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Rust/Cargo is required for Tauri. Install Rust with rustup and the Microsoft C++ Build Tools, then try again." -ForegroundColor Red
    exit 1
}

& (Join-Path $PSScriptRoot "start_backend.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

New-Item -Path $SafeDevRoot -ItemType Directory -Force | Out-Null

Write-Host "Syncing frontend to a Windows-safe build path..." -ForegroundColor Cyan
& robocopy $SourceFrontendPath $FrontendPath /MIR /XD `
    (Join-Path $SourceFrontendPath "node_modules") `
    (Join-Path $SourceFrontendPath "dist") `
    (Join-Path $SourceFrontendPath "src-tauri\target") `
    (Join-Path $SourceFrontendPath ".git") `
    /XF "*.log" | Out-Null

if ($LASTEXITCODE -ge 8) {
    Write-Host "Failed to sync frontend to $FrontendPath." -ForegroundColor Red
    exit $LASTEXITCODE
}

$DevSidecarDir = Join-Path $FrontendPath "src-tauri\binaries"
$DevSidecarPath = Join-Path $DevSidecarDir "sonotext-backend-x86_64-pc-windows-msvc.exe"
if (-not (Test-Path $DevSidecarPath)) {
    New-Item -Path $DevSidecarDir -ItemType Directory -Force | Out-Null
    Copy-Item (Join-Path $env:SystemRoot "System32\cmd.exe") $DevSidecarPath -Force
}

$installExitCode = 0
if (-not (Test-Path $TauriCliPath)) {
    Push-Location $FrontendPath
    try {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        & bun install
        $installExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($installExitCode -ne 0) {
        exit $installExitCode
    }
}

$tauriExitCode = 0
Push-Location $FrontendPath
try {
    Write-Host "Starting Sonotext desktop app..." -ForegroundColor Green
    & bun run tauri:dev
    $tauriExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $tauriExitCode
