$SourceFrontendPath = Join-Path $PSScriptRoot "frontend"
$SafeBuildRoot = Join-Path $env:LOCALAPPDATA "Sonotext\tauri-build"
$FrontendPath = Join-Path $SafeBuildRoot "frontend"
$PortablePath = Join-Path $SafeBuildRoot "portable\Sonotext"
$SourceSidecarPath = Join-Path $SourceFrontendPath "src-tauri\binaries\sonotext-backend-x86_64-pc-windows-msvc.exe"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Bun is required to build the frontend." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Rust/Cargo is required for Tauri. Install Rust with rustup and the Microsoft C++ Build Tools, then try again." -ForegroundColor Red
    exit 1
}

& (Join-Path $PSScriptRoot "build_backend_sidecar.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if (-not (Test-Path $SourceSidecarPath)) {
    Write-Host "Backend sidecar is missing: $SourceSidecarPath" -ForegroundColor Red
    exit 1
}

New-Item -Path $SafeBuildRoot -ItemType Directory -Force | Out-Null

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

$TauriCliPath = Join-Path $FrontendPath "node_modules\.bin\tauri.cmd"
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

Push-Location $FrontendPath
try {
    Write-Host "Building Sonotext desktop app..." -ForegroundColor Green
    & bun run tauri:build -- --no-bundle
    $buildExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($buildExitCode -ne 0) {
    exit $buildExitCode
}

$ReleasePath = Join-Path $FrontendPath "src-tauri\target\release"
$AppExePath = Join-Path $ReleasePath "sonotext.exe"
$ReleaseSidecarExePath = Join-Path $ReleasePath "sonotext-backend.exe"
$SyncedSidecarPath = Join-Path $FrontendPath "src-tauri\binaries\sonotext-backend-x86_64-pc-windows-msvc.exe"

if (-not (Test-Path $AppExePath)) {
    Write-Host "Tauri build completed, but the app executable was not found: $AppExePath" -ForegroundColor Red
    exit 1
}

if (Test-Path $ReleaseSidecarExePath) {
    $SidecarExePath = $ReleaseSidecarExePath
}
elseif (Test-Path $SyncedSidecarPath) {
    $SidecarExePath = $SyncedSidecarPath
}
else {
    Write-Host "Tauri build completed, but the backend sidecar was not found." -ForegroundColor Red
    Write-Host "Checked:" -ForegroundColor Yellow
    Write-Host "  $ReleaseSidecarExePath" -ForegroundColor Yellow
    Write-Host "  $SyncedSidecarPath" -ForegroundColor Yellow
    exit 1
}

if (Test-Path $PortablePath) {
    Remove-Item $PortablePath -Recurse -Force
}

New-Item -Path $PortablePath -ItemType Directory -Force | Out-Null
Copy-Item $AppExePath (Join-Path $PortablePath "sonotext.exe") -Force
Copy-Item $SidecarExePath (Join-Path $PortablePath "sonotext-backend.exe") -Force
Set-Content -Path (Join-Path $PortablePath "Start Sonotext.bat") -Value "@echo off`r`nstart """" ""%~dp0sonotext.exe""`r`n"

Write-Host "Portable release created:" -ForegroundColor Cyan
Write-Host "  $PortablePath" -ForegroundColor Cyan
Write-Host "Run Start Sonotext.bat or sonotext.exe from that folder." -ForegroundColor Cyan

exit $buildExitCode
