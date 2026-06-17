#!/usr/bin/env bash
#
# One-time ZONOS2 setup for use with Sonotext.
# Run this INSIDE your WSL2 (Ubuntu) shell:
#
#   bash /mnt/c/StarryStuff/Programming/Sonotext/zonos2/setup_wsl.sh
#
# It installs system deps + uv, clones ZONOS2 to ~/ZONOS2 (the path Sonotext
# expects by default), and runs `uv sync`. Re-running is safe (idempotent).
set -euo pipefail

REPO_DIR="${ZONOS2_DIR:-$HOME/ZONOS2}"
REPO_URL="https://github.com/Zyphra/ZONOS2.git"

echo "==> ZONOS2 setup for Sonotext"
echo "    Target repo dir: $REPO_DIR"

if grep -qiv microsoft /proc/version 2>/dev/null; then
    echo "    Note: this does not look like WSL2. ZONOS2 needs a Linux env with an NVIDIA GPU."
fi

echo "==> Installing system dependencies (sudo may prompt for your password)"
sudo apt-get update
sudo apt-get install -y git build-essential ffmpeg curl

if ! command -v uv >/dev/null 2>&1; then
    echo "==> Installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
# Make uv available in this shell
# shellcheck disable=SC1091
source "$HOME/.local/bin/env" 2>/dev/null || export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
    echo "ERROR: uv is not on PATH. Open a new shell and re-run, or add ~/.local/bin to PATH." >&2
    exit 1
fi

if [ -d "$REPO_DIR/.git" ]; then
    echo "==> Updating existing clone in $REPO_DIR"
    git -C "$REPO_DIR" pull --ff-only || echo "    (skip) could not fast-forward; leaving repo as-is"
else
    echo "==> Cloning ZONOS2 into $REPO_DIR"
    git clone "$REPO_URL" "$REPO_DIR"
fi

echo "==> Installing Python dependencies with uv (this can take a while)"
cd "$REPO_DIR"
uv sync

echo
echo "==> Checking GPU visibility inside WSL2"
if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi -L || true
else
    echo "    WARNING: nvidia-smi not found. Update your NVIDIA Windows driver for WSL2 CUDA."
fi

cat <<EOF

==> Done.

Test the server manually:
    cd "$REPO_DIR"
    uv run python -m zonos2 --model-path Zyphra/ZONOS2 --host 0.0.0.0 --port 1919

The first run downloads the model (several GB) and may take a few minutes.
Then, in Sonotext: open the Model Manager, confirm the ZONOS2 settings, and
either click Start or just pick the ZONOS2 engine and Generate.
EOF
