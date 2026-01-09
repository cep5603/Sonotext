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
$torchCheck = & "$VenvPath\Scripts\python.exe" -c "import torch; print(torch.cuda.is_available())" 2>$null
if ($torchCheck -ne "True") {
    Write-Host "Installing PyTorch with CUDA 12.8..." -ForegroundColor Yellow
    & "$VenvPath\Scripts\pip.exe" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
}

# Install other dependencies
Write-Host "Installing Backend Dependencies..." -ForegroundColor Yellow
& "$VenvPath\Scripts\pip.exe" install -r "$BackendPath\requirements.txt" --upgrade -q

Write-Host "Starting Backend Server..." -ForegroundColor Green
Start-Process -FilePath "$VenvPath\Scripts\python.exe" -ArgumentList "main.py" -WorkingDirectory $BackendPath -NoNewWindow -PassThru

Write-Host "Starting Frontend Server..." -ForegroundColor Green
Start-Process -FilePath "bun" -ArgumentList "run dev" -WorkingDirectory $FrontendPath -NoNewWindow -PassThru

Write-Host "Both servers started. Access the app at http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend API is at http://localhost:8000" -ForegroundColor Cyan
