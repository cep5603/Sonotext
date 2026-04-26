# Sonotext

A local text-to-speech application powered by [Kokoro](https://github.com/hexgrad/kokoro) and [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS).

![Sonotext](frontend/src/assets/sonotext-logo-full.png)

## Features

- **A lotta voices** — For Kokoro, some are okay, and some are terrible. For Qwen, there are only a few, but you can make your own.
- **Multi-language TTS** — You can also control the phonemization language separately.
- **GPU-accelerated** — Uses CUDA. You need it.
    - Uses chunking to handle any size of input text.
- **LLM-based text cleanup** — Optional integration with LM Studio to clean/reformat text before synthesis. Or just strip common markdown formatting.
    - It also auto-names files for you upon generation.
- **History** — Browse/replay/manage previous generations.
- **Audio-text sync** — Click any word to seek. The detail view highlights playback and can auto-scroll.

## Quick Start

### Installation (Windows)

```powershell
# Clone the repo
git clone https://github.com/cep5603/Sonotext.git
cd Sonotext

# Run the browser app (auto-installs backend dependencies)
.\start_app.ps1
```

Or double-click `start_app.bat`.

### Tauri Desktop (Windows)

Tauri 2 requires the current Windows prerequisites from the official docs:

- Install Rust with `rustup`
- Install the Microsoft C++ Build Tools
- Make sure Microsoft Edge WebView2 is available

Then start the desktop shell:

```powershell
.\start_tauri.ps1
```

Or double-click `start_tauri.bat`.

The desktop launcher reuses the local Python backend at `http://127.0.0.1:8000` and opens the frontend inside a native Tauri window instead of a browser tab.

On Windows, the desktop launcher syncs the frontend into `%LOCALAPPDATA%\Sonotext\tauri-dev\frontend` before starting Tauri. This avoids Windows resource compiler failures when the repository path contains characters such as apostrophes.

To build an MSI desktop installer with the Python backend bundled as a Tauri sidecar:

```powershell
.\build_tauri.ps1
```

Or double-click `build_tauri.bat`.

The build script packages the FastAPI backend with PyInstaller, copies it to Tauri's sidecar binary folder, syncs the frontend into `%LOCALAPPDATA%\Sonotext\tauri-build\frontend`, and runs the Tauri production build. The packaged backend stores generated audio, history, projects, voice profiles, and model cache under `%LOCALAPPDATA%\Sonotext\backend`.

The backend sidecar is large, so the production package uses MSI instead of NSIS. If MSI packaging fails around `light.exe`, enable the Windows VBSCRIPT optional feature from Windows Features and retry.

### LM Studio Integration

1. Install [LM Studio](https://lmstudio.ai/).
2. Load a model and start the local server (default is `http://localhost:1234`).
3. The text cleanup feature should automatically connect after a bit.
