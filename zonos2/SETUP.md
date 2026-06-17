# ZONOS2 in WSL2 — One-Time Setup

[ZONOS2](https://github.com/Zyphra/ZONOS2) is Zyphra's open-weight, real-time
text-to-speech MoE with high-fidelity zero-shot voice cloning. It is **Linux-only**
and ships as its own HTTP inference server. Sonotext is a Windows app, so we run
the ZONOS2 server inside **WSL2** and Sonotext proxies requests to it.

Once set up, Sonotext can auto-launch/stop the server for you (see the
**Model Manager → ZONOS2 Server** panel), or you can run it yourself.

## Requirements

- **Windows 10/11 with WSL2** and a Linux distro (Ubuntu recommended).
- An **NVIDIA GPU** with the current Windows driver. CUDA is accessed inside WSL2
  through the Windows driver — do **not** install a separate Linux GPU driver.
- Enough disk space for the model weights (several GB, downloaded on first run).

## 1. Install WSL2 (PowerShell, as Administrator)

```powershell
wsl --install -d Ubuntu
wsl --update
```

Reboot if prompted, then open the **Ubuntu** terminal once to create your user.

Verify the GPU is visible inside WSL2:

```bash
nvidia-smi
```

If `nvidia-smi` fails, update your NVIDIA driver on Windows (it must support WSL2
CUDA) and run `wsl --shutdown` from PowerShell, then reopen Ubuntu.

## 2. Run the setup script

From the Sonotext repo on Windows, copy the helper script into WSL and run it,
**or** just paste the commands below into your WSL2 (Ubuntu) shell:

```bash
sudo apt-get update
sudo apt-get install -y git build-essential ffmpeg curl

# Install uv (the package manager ZONOS2 uses)
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env" 2>/dev/null || export PATH="$HOME/.local/bin:$PATH"

# Clone ZONOS2 to the path Sonotext expects by default (~/ZONOS2)
git clone https://github.com/Zyphra/ZONOS2.git "$HOME/ZONOS2"
cd "$HOME/ZONOS2"

# Install dependencies into the project environment
uv sync
```

Alternatively, run the bundled script (replace the path with where the Sonotext
repo lives on your Windows drive):

```bash
bash /mnt/c/StarryStuff/Programming/Sonotext/zonos2/setup_wsl.sh
```

## 3. Verify the server works

```bash
cd "$HOME/ZONOS2"
uv run python -m zonos2 --model-path Zyphra/ZONOS2 --host 0.0.0.0 --port 1919
```

The first launch downloads the model, so it can take several minutes. When you
see it listening on `http://0.0.0.0:1919`, open a second shell and test:

```bash
curl -s http://localhost:1919/v1/models
```

From **Windows**, `http://localhost:1919` reaches the WSL2 server thanks to WSL2's
localhost forwarding. You can stop the manual server with `Ctrl+C`.

## 4. Use it from Sonotext

1. Open Sonotext, click **Model Manager** (bottom of the settings sidebar).
2. In the **ZONOS2 Server (WSL2)** panel, confirm:
   - **WSL distro** — leave blank to use your default distro, or set e.g. `Ubuntu`.
   - **Repo path** — `~/ZONOS2` (the default).
   - **Model path** — `Zyphra/ZONOS2` (a HF repo id) or a local path inside WSL.
   - **Port** — `1919`.
   - **Auto-launch on generate** — leave on to let Sonotext start the server when
     you generate with ZONOS2.
3. Click **Start** (or just pick the **ZONOS2** engine and press Generate).
4. Select the **ZONOS2** engine in the settings sidebar. Use the **Default** voice,
   or pick a **custom voice** (created in *Manage Custom Voices* from a short audio
   sample) to clone it zero-shot.

## Notes

- **Voice cloning** uses a short reference clip from your Sonotext voice profiles;
  no extra files are needed inside WSL.
- Server logs are written to `backend/logs/zonos2-server.log` on the Windows side.
- If startup fails, the Model Manager shows the error and the log tail.
- Avoid spaces in the **Repo path** / **Model path** (they are passed to a shell).
