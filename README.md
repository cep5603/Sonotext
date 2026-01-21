# Sonotext

A local text-to-speech application powered by [Kokoro](https://github.com/hexgrad/kokoro), supporting 9 languages with GPU acceleration.

![Sonotext](frontend/src/assets/sonotext-logo-full.png)

## Features

- **A lotta voices** — Some are okay, some are terrible.
- **Multi-language TTS** — American/British English, Spanish, French, Hindi, Italian, Portuguese (also Japanese and Chinese but they're kinda broken).
    - You can also control the phonemization language separately.
- **GPU-accelerated** — Uses CUDA. You need it.
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

# Run the app (auto-installs dependencies)
.\start_app.ps1
```

Or double-click `start_app.bat`.

### LM Studio Integration

1. Install [LM Studio](https://lmstudio.ai/).
2. Load a model (I usually use `gemma-3-4b`) and start the local server (default is `http://localhost:1234`).
3. The text cleanup feature should automatically connect after a bit.
