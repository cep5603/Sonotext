#!/usr/bin/env bash
#
# One-time ZONOS2 setup for use with Sonotext.
# Run this INSIDE your WSL2 (Ubuntu) shell:
#
#   bash /mnt/c/<path-to-Sonotext>/zonos2/setup_wsl.sh
#
# It installs system deps + uv, clones ZONOS2 to ~/ZONOS2 (the path Sonotext
# expects by default), runs `uv sync`, and installs the CUDA toolkit (nvcc)
# needed for JIT-compiled kernels. Re-running is safe (idempotent).
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
sudo apt-get install -y git build-essential ffmpeg curl wget

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

echo "==> Installing CUDA toolkit (nvcc) for JIT-compiled kernels"
# ZONOS2 JIT-compiles custom CUDA kernels at runtime, which requires nvcc.
# WSL2 ships only the Windows driver, not the toolkit. cuda-minimal-build
# installs only the compiler, NOT a Linux GPU driver (which must never be
# installed in WSL2). Version 12.8 matches ZONOS2's torch cu128 wheel.
if ! command -v nvcc >/dev/null 2>&1; then
    wget -q https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb -O /tmp/cuda-keyring.deb
    sudo dpkg -i /tmp/cuda-keyring.deb
    sudo apt-get update
    sudo apt-get install -y cuda-minimal-build-12-8
    # Persist CUDA_HOME and PATH so the server (launched via bash -lc) finds nvcc
    grep -q 'CUDA_HOME=/usr/local/cuda-12.8' ~/.bashrc 2>/dev/null || echo 'export CUDA_HOME=/usr/local/cuda-12.8' >> ~/.bashrc
    grep -q 'CUDA_HOME/bin:$PATH' ~/.bashrc 2>/dev/null || echo 'export PATH=$CUDA_HOME/bin:$PATH' >> ~/.bashrc
    export CUDA_HOME=/usr/local/cuda-12.8
    export PATH="$CUDA_HOME/bin:$PATH"
else
    echo "    nvcc already installed, skipping."
fi

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
