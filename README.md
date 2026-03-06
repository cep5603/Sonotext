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

# Run the app (auto-installs dependencies)
.\start_app.ps1
```

Or double-click `start_app.bat`.

### LM Studio Integration

1. Install [LM Studio](https://lmstudio.ai/).
2. Load a model and start the local server (default is `http://localhost:1234`).
3. The text cleanup feature should automatically connect after a bit.
