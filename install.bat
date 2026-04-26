@echo off
setlocal
pushd "%~dp0"

set BACKEND=backend
set FRONTEND=frontend
set VENV=%BACKEND%\.venv
set DIST=dist\Sonotext

echo Installing Sonotext...
echo.

if not exist "%VENV%\Scripts\python.exe" (
  echo Creating Python virtual environment...
  python -m venv "%VENV%"
  if errorlevel 1 goto :fail
)

if not exist "%VENV%\.torch_checked" (
  echo Checking PyTorch CUDA install...
  "%VENV%\Scripts\python.exe" -c "import sys; import torch; sys.exit(0 if torch.cuda.is_available() else 1)" 2>nul
  if errorlevel 1 (
    echo Installing PyTorch with CUDA 12.8...
    "%VENV%\Scripts\pip.exe" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
    if errorlevel 1 goto :fail
  )
  type nul > "%VENV%\.torch_checked"
)

echo Installing backend dependencies...
"%VENV%\Scripts\pip.exe" install -r "%BACKEND%\requirements.txt" --upgrade
if errorlevel 1 goto :fail

echo Building frontend...
pushd "%FRONTEND%"
bun install
if errorlevel 1 goto :fail
bun run build
if errorlevel 1 goto :fail
popd

echo Building Windows launcher...
dotnet build "launcher\Sonotext.Launcher.csproj" -c Release
if errorlevel 1 goto :fail
if not exist "%DIST%" mkdir "%DIST%"
xcopy /E /I /Y "launcher\bin\Release\net8.0-windows\*" "%DIST%\" >nul
if errorlevel 1 goto :fail

echo.
echo Sonotext launcher built at %DIST%\Sonotext.exe
echo Run it after this installer completes.
popd
echo.
pause
endlocal
exit /b 0

:fail
set EXIT_CODE=%ERRORLEVEL%
echo.
echo Install failed with exit code %EXIT_CODE%.
echo Check the error output above.
echo.
pause
popd
endlocal
exit /b %EXIT_CODE%
