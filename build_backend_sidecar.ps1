$BackendPath = Join-Path $PSScriptRoot "backend"
$VenvPath = Join-Path $BackendPath ".venv"
$TauriBinariesPath = Join-Path $PSScriptRoot "frontend\src-tauri\binaries"
$DistPath = Join-Path $BackendPath "dist"
$BuildPath = Join-Path $BackendPath "build"
$TargetTriple = "x86_64-pc-windows-msvc"
$SidecarBaseName = "sonotext-backend"
$SidecarFileName = "$SidecarBaseName-$TargetTriple.exe"
$SidecarOutputPath = Join-Path $TauriBinariesPath $SidecarFileName

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python is required to build the backend sidecar." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$VenvPath\Scripts\python.exe")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$PythonExe = Join-Path $VenvPath "Scripts\python.exe"
$PipExe = Join-Path $VenvPath "Scripts\pip.exe"

Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
& $PipExe install torch torchvision torchaudio torchcodec --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $PipExe install -r (Join-Path $BackendPath "requirements.txt") --upgrade
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $PipExe install "pyinstaller>=6.0"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $PythonExe -m spacy download en_core_web_sm
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

New-Item -Path $TauriBinariesPath -ItemType Directory -Force | Out-Null

Push-Location $BackendPath
try {
    Write-Host "Building backend sidecar with PyInstaller..." -ForegroundColor Green
    & $PythonExe -m PyInstaller `
        --clean `
        --noconfirm `
        --onefile `
        --name $SidecarBaseName `
        --collect-all kokoro `
        --collect-all misaki `
        --collect-all spacy `
        --collect-all en_core_web_sm `
        --collect-all language_tags `
        --collect-all espeakng_loader `
        --collect-all qwen_tts `
        --collect-submodules qwen_tts `
        --collect-all transformers `
        --collect-submodules transformers `
        --collect-all tokenizers `
        --collect-all safetensors `
        --collect-all huggingface_hub `
        --collect-all accelerate `
        --collect-all torchcodec `
        --copy-metadata qwen_tts `
        --copy-metadata transformers `
        --copy-metadata tokenizers `
        --copy-metadata safetensors `
        --copy-metadata huggingface_hub `
        --copy-metadata accelerate `
        --copy-metadata torchcodec `
        --collect-all faster_whisper `
        --collect-all ctranslate2 `
        --collect-all pyopenjtalk `
        --hidden-import transformers.models.auto.processing_auto `
        --hidden-import transformers.models.auto.feature_extraction_auto `
        --hidden-import transformers.models.auto.tokenization_auto `
        --hidden-import transformers.models.auto.modeling_auto `
        --hidden-import transformers.models.auto.configuration_auto `
        --hidden-import transformers.models.qwen2.tokenization_qwen2 `
        --hidden-import transformers.models.qwen2.tokenization_qwen2_fast `
        --hidden-import qwen_tts.inference.qwen3_tts_model `
        --hidden-import qwen_tts.inference.qwen3_tts_tokenizer `
        --hidden-import qwen_tts.core.models.configuration_qwen3_tts `
        --hidden-import qwen_tts.core.models.modeling_qwen3_tts `
        --hidden-import qwen_tts.core.models.processing_qwen3_tts `
        --hidden-import qwen_tts.core.tokenizer_12hz.configuration_qwen3_tts_tokenizer_v2 `
        --hidden-import qwen_tts.core.tokenizer_12hz.modeling_qwen3_tts_tokenizer_v2 `
        --hidden-import qwen_tts.core.tokenizer_25hz.configuration_qwen3_tts_tokenizer_v1 `
        --hidden-import qwen_tts.core.tokenizer_25hz.modeling_qwen3_tts_tokenizer_v1 `
        --hidden-import en_core_web_sm `
        --hidden-import uvicorn.logging `
        --hidden-import uvicorn.loops.auto `
        --hidden-import uvicorn.protocols.http.auto `
        --hidden-import uvicorn.protocols.websockets.auto `
        --hidden-import sse_starlette.sse `
        --distpath $DistPath `
        --workpath $BuildPath `
        main.py
    $buildExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($buildExitCode -ne 0) {
    exit $buildExitCode
}

$BuiltExe = Join-Path $DistPath "$SidecarBaseName.exe"
if (-not (Test-Path $BuiltExe)) {
    Write-Host "Expected sidecar executable was not created: $BuiltExe" -ForegroundColor Red
    exit 1
}

Copy-Item $BuiltExe $SidecarOutputPath -Force
Write-Host "Backend sidecar copied to $SidecarOutputPath" -ForegroundColor Cyan
