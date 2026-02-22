$BackendPath = ".\backend"
$FrontendPath = ".\frontend"
$VenvPath = "$BackendPath\.venv"

Write-Host "Starting Sonotext..." -ForegroundColor Cyan

# Create virtual environment if it doesn't exist
if (-not (Test-Path "$VenvPath\Scripts\python.exe")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvPath
}

# Check if PyTorch with CUDA is installed
$TorchCheckPath = "$VenvPath\.torch_checked"
if (-not (Test-Path $TorchCheckPath)) {
    $torchCheck = & "$VenvPath\Scripts\python.exe" -c "import sys; import torch; sys.exit(0 if torch.cuda.is_available() else 1)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing PyTorch with CUDA 12.8..." -ForegroundColor Yellow
        & "$VenvPath\Scripts\pip.exe" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
        if ($LASTEXITCODE -eq 0) { New-Item -Path $TorchCheckPath -ItemType File -Force | Out-Null }
    } else {
        New-Item -Path $TorchCheckPath -ItemType File -Force | Out-Null
    }
}

# Install other dependencies only if requirements.txt changed
$ReqPath = "$BackendPath\requirements.txt"
$HashPath = "$VenvPath\.req_hash"
$skipInstall = $false

if ((Test-Path $HashPath) -and (Test-Path $ReqPath)) {
    $currentHash = (Get-FileHash $ReqPath -Algorithm MD5).Hash
    $savedHash = (Get-Content $HashPath -ErrorAction SilentlyContinue).Trim()
    if ($currentHash -eq $savedHash) {
        $skipInstall = $true
    }
}

if (-not $skipInstall) {
    Write-Host "Installing Backend Dependencies..." -ForegroundColor Yellow
    & "$VenvPath\Scripts\pip.exe" install -r $ReqPath --upgrade -q
    if ($LASTEXITCODE -eq 0) {
        (Get-FileHash $ReqPath -Algorithm MD5).Hash | Out-File $HashPath -Encoding UTF8
    }
} else {
    Write-Host "Backend dependencies are up-to-date." -ForegroundColor DarkGray
}
Write-Host "Starting Backend Server..." -ForegroundColor Green
Start-Process -FilePath "$VenvPath\Scripts\python.exe" -ArgumentList "main.py" -WorkingDirectory $BackendPath -NoNewWindow -PassThru

Write-Host "Starting Frontend Server..." -ForegroundColor Green
Start-Process -FilePath "bun" -ArgumentList "run dev" -WorkingDirectory $FrontendPath -NoNewWindow -PassThru

Write-Host "Both servers started. Access the app at http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend API is at http://localhost:8000" -ForegroundColor Cyan
