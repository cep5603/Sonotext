$BackendPath = Join-Path $PSScriptRoot "backend"
$VenvPath = Join-Path $BackendPath ".venv"
$BackendPort = 8000

function Test-PortOpen {
    param(
        [string]$HostName,
        [int]$Port
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(500)
        if (-not $connected) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortOpen -HostName $HostName -Port $Port) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }

    return $false
}

if (Test-PortOpen -HostName "127.0.0.1" -Port $BackendPort) {
    Write-Host "Backend server is already running on http://127.0.0.1:$BackendPort" -ForegroundColor DarkGray
    exit 0
}

Write-Host "Preparing backend..." -ForegroundColor Cyan

if (-not (Test-Path "$VenvPath\Scripts\python.exe")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$TorchCheckPath = "$VenvPath\.torch_checked"
if (-not (Test-Path $TorchCheckPath)) {
    & "$VenvPath\Scripts\python.exe" -c "import sys; import torch; sys.exit(0 if torch.cuda.is_available() else 1)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing PyTorch with CUDA 12.8..." -ForegroundColor Yellow
        & "$VenvPath\Scripts\pip.exe" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        New-Item -Path $TorchCheckPath -ItemType File -Force | Out-Null
    }
    else {
        New-Item -Path $TorchCheckPath -ItemType File -Force | Out-Null
    }
}

$ReqPath = Join-Path $BackendPath "requirements.txt"
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
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    & "$VenvPath\Scripts\pip.exe" install -r $ReqPath --upgrade -q
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    (Get-FileHash $ReqPath -Algorithm MD5).Hash | Out-File $HashPath -Encoding UTF8
}
else {
    Write-Host "Backend dependencies are up-to-date." -ForegroundColor DarkGray
}

Write-Host "Starting backend server..." -ForegroundColor Green
Start-Process -FilePath "$VenvPath\Scripts\python.exe" -ArgumentList "main.py" -WorkingDirectory $BackendPath -NoNewWindow -PassThru | Out-Null

if (Wait-ForPort -HostName "127.0.0.1" -Port $BackendPort -TimeoutSeconds 30) {
    Write-Host "Backend API is ready at http://127.0.0.1:$BackendPort" -ForegroundColor Cyan
    exit 0
}

Write-Host "Backend process started, but port $BackendPort did not become ready within 30 seconds." -ForegroundColor Yellow
exit 0
