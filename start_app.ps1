$BackendPath = ".\backend"
$FrontendPath = ".\frontend"
$VenvPath = "$BackendPath\.venv"

Write-Host "Starting Sonotext..." -ForegroundColor Cyan

# Create virtual environment if it doesn't exist
if (-not (Test-Path "$VenvPath\Scripts\python.exe")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvPath
}

# Activate venv and install dependencies
Write-Host "Installing Backend Dependencies..." -ForegroundColor Yellow
& "$VenvPath\Scripts\pip.exe" uninstall -y onnxruntime 2>$null
& "$VenvPath\Scripts\pip.exe" install -r "$BackendPath\requirements.txt" --upgrade

$env:ONNX_PROVIDER = 'CUDAExecutionProvider'

Write-Host "Starting Backend Server..." -ForegroundColor Green
Start-Process -FilePath "$VenvPath\Scripts\python.exe" -ArgumentList "main.py" -WorkingDirectory $BackendPath -NoNewWindow -PassThru

Write-Host "Starting Frontend Server..." -ForegroundColor Green
Start-Process -FilePath "bun" -ArgumentList "run dev" -WorkingDirectory $FrontendPath -NoNewWindow -PassThru

Write-Host "Both servers started. Access the app at http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend API is at http://localhost:8000" -ForegroundColor Cyan
