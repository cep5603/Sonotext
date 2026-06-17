"""
ZONOS2 Manager

ZONOS2 (https://github.com/Zyphra/ZONOS2) is a Linux-only, open-weight TTS MoE
that ships as its own HTTP inference server. Sonotext is a Windows app, so we run
the ZONOS2 server inside WSL2 and proxy requests to it over HTTP.

This manager:
- Persists configuration (WSL distro, repo path, model path, port, ...).
- Detects whether the ZONOS2 server is already running.
- Auto-launches / stops the server inside WSL2 on demand.
- Proxies text-to-speech generation (incl. zero-shot voice cloning via a base64
  reference clip) and decodes the raw PCM response into a numpy waveform.

The ZONOS2 server exposes:
- POST /tts/generate  -> raw PCM (float32, 44.1 kHz, mono); supports stream=false.
- POST /v1/audio/speech (OpenAI-compatible)
- GET  /v1/models
Voice cloning is driven by `speaker_audio_base64` (a reference clip) on the
generate request, so no embedding files need to be managed on disk.
"""

import os
import json
import time
import base64
import logging
import threading
import subprocess
from pathlib import Path

import numpy as np
import requests

logger = logging.getLogger("Zonos2Manager")

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "zonos2_config.json"
SERVER_LOG_PATH = BASE_DIR / "logs" / "zonos2-server.log"

# Languages supported by the ZONOS2 /tts/generate endpoint.
ZONOS2_LANGUAGES = [
    {"value": "en_us", "label": "English (US)"},
    {"value": "en_gb", "label": "English (UK)"},
    {"value": "fr_fr", "label": "French"},
    {"value": "de", "label": "German"},
    {"value": "es", "label": "Spanish"},
    {"value": "it", "label": "Italian"},
    {"value": "pt_br", "label": "Portuguese (BR)"},
    {"value": "ja", "label": "Japanese"},
    {"value": "cmn", "label": "Mandarin Chinese"},
    {"value": "ko", "label": "Korean"},
]
ZONOS2_LANGUAGE_CODES = {lang["value"] for lang in ZONOS2_LANGUAGES}

ZONOS2_SAMPLE_RATE = 44100

DEFAULT_CONFIG = {
    # Empty distro => use the default WSL distribution (no `-d` flag).
    "distro": "",
    # Path *inside WSL* to the cloned ZONOS2 repository. Avoid spaces.
    "repo_dir": "~/ZONOS2",
    # Hugging Face repo id or a local path inside WSL.
    "model_path": "Zyphra/ZONOS2",
    # Host the Windows side connects to (WSL2 forwards localhost to Windows).
    "host": "127.0.0.1",
    # Host the server binds to inside WSL2 (0.0.0.0 keeps localhost forwarding happy).
    "bind_host": "0.0.0.0",
    "port": 1919,
    "dtype": "auto",
    # Optional directory (inside WSL) of default speaker clips / embeddings.
    "default_voices_dir": "",
    # Extra raw args appended to the launch command.
    "extra_args": "",
    # Auto-launch the server in WSL2 when ZONOS2 generation is requested.
    "auto_launch": True,
}


class Zonos2Manager:
    """Manages the ZONOS2 server running inside WSL2 and proxies requests to it."""

    def __init__(self):
        self._config = dict(DEFAULT_CONFIG)
        self._load_config()
        self._process: subprocess.Popen | None = None
        self._launching = False
        self._last_error: str | None = None
        self._lock = threading.Lock()
        # Tiny cache to avoid hammering the health endpoint from the status stream.
        self._running_cache: bool = False
        self._running_cache_at: float = 0.0
        # WSL availability changes rarely; cache it longer to avoid spawning
        # `wsl.exe` on every status tick.
        self._wsl_cache: bool | None = None
        self._wsl_cache_at: float = 0.0
        logger.info("Zonos2Manager initialized (server managed in WSL2).")

    # ------------------------------------------------------------------ config

    def _load_config(self) -> None:
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                if isinstance(saved, dict):
                    # Merge over defaults so new keys are picked up automatically.
                    self._config = {**DEFAULT_CONFIG, **saved}
            except Exception as e:
                logger.warning(f"Failed to load ZONOS2 config, using defaults: {e}")

    def _save_config(self) -> None:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self._config, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save ZONOS2 config: {e}")

    def get_config(self) -> dict:
        return dict(self._config)

    def update_config(self, patch: dict) -> dict:
        """Apply a partial config update and persist it."""
        allowed = set(DEFAULT_CONFIG.keys())
        for key, value in patch.items():
            if key in allowed and value is not None:
                self._config[key] = value
        self._save_config()
        logger.info("ZONOS2 config updated.")
        return self.get_config()

    # --------------------------------------------------------------- endpoints

    def _base_url(self) -> str:
        return f"http://{self._config['host']}:{int(self._config['port'])}"

    def wsl_available(self) -> bool:
        """Return True if the `wsl.exe` command is available (cached ~30s)."""
        now = time.time()
        if self._wsl_cache is not None and (now - self._wsl_cache_at) < 30.0:
            return self._wsl_cache
        available = False
        try:
            result = subprocess.run(
                ["wsl.exe", "--status"],
                capture_output=True,
                timeout=10,
            )
            available = result.returncode == 0
        except Exception:
            # `--status` can be flaky on some setups; fall back to listing distros.
            try:
                result = subprocess.run(
                    ["wsl.exe", "-l", "-q"],
                    capture_output=True,
                    timeout=10,
                )
                available = result.returncode == 0
            except Exception:
                available = False
        self._wsl_cache = available
        self._wsl_cache_at = now
        return available

    def is_server_running(self, timeout: float = 1.5, use_cache: bool = True) -> bool:
        """Check whether the ZONOS2 server responds to a health probe."""
        now = time.time()
        if use_cache and (now - self._running_cache_at) < 0.8:
            return self._running_cache
        running = False
        try:
            resp = requests.get(f"{self._base_url()}/v1/models", timeout=timeout)
            running = resp.status_code == 200
        except Exception:
            running = False
        self._running_cache = running
        self._running_cache_at = now
        if running:
            self._launching = False
        return running

    # ----------------------------------------------------------- server launch

    def _build_launch_command(self) -> list[str]:
        cfg = self._config
        repo_dir = str(cfg["repo_dir"]).strip()
        model_path = str(cfg["model_path"]).strip()
        bind_host = str(cfg["bind_host"]).strip() or "0.0.0.0"
        port = int(cfg["port"])
        dtype = str(cfg["dtype"]).strip() or "auto"

        inner = (
            f"cd {repo_dir} && "
            f"exec uv run python -m zonos2 "
            f"--model-path {model_path} "
            f"--host {bind_host} --port {port} --dtype {dtype}"
        )
        voices_dir = str(cfg.get("default_voices_dir", "")).strip()
        if voices_dir:
            inner += f" --tts-default-voices-dir {voices_dir}"
        extra = str(cfg.get("extra_args", "")).strip()
        if extra:
            inner += f" {extra}"

        args = ["wsl.exe"]
        distro = str(cfg.get("distro", "")).strip()
        if distro:
            args += ["-d", distro]
        args += ["--", "bash", "-lic", inner]
        return args

    def start_server(self) -> dict:
        """Launch the ZONOS2 server inside WSL2 (non-blocking).

        Returns a status dict. Readiness is reported later via status()/health.
        """
        with self._lock:
            if self.is_server_running(use_cache=False):
                logger.info("ZONOS2 server already running; not launching.")
                return self.status()

            if not self.wsl_available():
                self._last_error = (
                    "WSL2 is not available. Install WSL2 and a Linux distribution, "
                    "then set up ZONOS2 (see zonos2/SETUP.md)."
                )
                logger.error(self._last_error)
                raise RuntimeError(self._last_error)

            # Reap a dead previous handle.
            if self._process is not None and self._process.poll() is not None:
                self._process = None

            if self._process is None:
                self._last_error = None
                cmd = self._build_launch_command()
                logger.info(f"Launching ZONOS2 server in WSL2: {' '.join(cmd)}")
                SERVER_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
                try:
                    log_handle = open(SERVER_LOG_PATH, "ab", buffering=0)
                    creationflags = 0
                    if os.name == "nt":
                        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    self._process = subprocess.Popen(
                        cmd,
                        stdout=log_handle,
                        stderr=log_handle,
                        stdin=subprocess.DEVNULL,
                        creationflags=creationflags,
                    )
                    self._launching = True
                except Exception as e:
                    self._last_error = f"Failed to launch ZONOS2 server: {e}"
                    logger.error(self._last_error)
                    raise RuntimeError(self._last_error)
        return self.status()

    def stop_server(self) -> dict:
        """Stop the ZONOS2 server running inside WSL2."""
        with self._lock:
            self._launching = False
            # Best-effort kill of the server process inside WSL2.
            try:
                cfg = self._config
                args = ["wsl.exe"]
                distro = str(cfg.get("distro", "")).strip()
                if distro:
                    args += ["-d", distro]
                args += ["--", "bash", "-lc", "pkill -f 'python -m zonos2' || true"]
                subprocess.run(args, capture_output=True, timeout=20)
            except Exception as e:
                logger.warning(f"Failed to pkill ZONOS2 server in WSL2: {e}")
            # Terminate the launcher handle on the Windows side.
            if self._process is not None:
                try:
                    self._process.terminate()
                except Exception:
                    pass
                self._process = None
            self._running_cache = False
            self._running_cache_at = 0.0
            logger.info("ZONOS2 server stop requested.")
        return self.status()

    def ensure_server(self, timeout: float = 300.0) -> None:
        """Ensure the server is up, launching it if auto-launch is enabled.

        Blocks until the server is reachable or `timeout` seconds elapse. This is
        intended for the generation path, where the user is actively waiting.
        """
        if self.is_server_running(use_cache=False):
            return

        if not self._config.get("auto_launch", True):
            raise RuntimeError(
                "ZONOS2 server is not running and auto-launch is disabled. "
                "Start it from the Model Manager or in WSL2 manually."
            )

        self.start_server()

        deadline = time.time() + timeout
        while time.time() < deadline:
            # Surface an early crash instead of waiting the full timeout.
            if self._process is not None and self._process.poll() is not None:
                self._launching = False
                tail = self._read_log_tail()
                raise RuntimeError(
                    "ZONOS2 server process exited during startup. "
                    f"Recent log:\n{tail}"
                )
            if self.is_server_running(use_cache=False):
                logger.info("ZONOS2 server is ready.")
                return
            time.sleep(2.0)

        raise RuntimeError(
            f"ZONOS2 server did not become ready within {int(timeout)}s. "
            "First launch may need to download the model; check "
            "backend/logs/zonos2-server.log."
        )

    def _read_log_tail(self, max_chars: int = 1500) -> str:
        try:
            if SERVER_LOG_PATH.exists():
                data = SERVER_LOG_PATH.read_text(encoding="utf-8", errors="replace")
                return data[-max_chars:]
        except Exception:
            pass
        return "(no log available)"

    # --------------------------------------------------------------- inference

    def generate(
        self,
        text: str,
        language: str = "en_us",
        speaker_audio_b64: str | None = None,
        speaker_audio_name: str | None = None,
        seed: int | None = None,
        temperature: float | None = None,
        speaking_rate: float | None = None,
        request_timeout: float = 600.0,
    ) -> tuple[np.ndarray, int]:
        """Synthesize a chunk of text and return (samples, sample_rate).

        Voice cloning is performed by passing a base64-encoded reference clip via
        `speaker_audio_b64`. When omitted, the model's default voice is used.
        """
        self.ensure_server()

        lang = language if language in ZONOS2_LANGUAGE_CODES else "en_us"
        payload: dict = {
            "text": text,
            "language": lang,
            "stream": False,
        }
        if speaker_audio_b64:
            payload["speaker_audio_base64"] = speaker_audio_b64
            if speaker_audio_name:
                payload["speaker_audio_name"] = speaker_audio_name
        if seed is not None:
            payload["seed"] = int(seed)
        if temperature is not None:
            payload["temperature"] = float(temperature)
        if speaking_rate is not None:
            payload["speaking_rate_enabled"] = True
            payload["speaking_rate"] = float(speaking_rate)

        try:
            resp = requests.post(
                f"{self._base_url()}/tts/generate",
                json=payload,
                timeout=request_timeout,
            )
        except requests.RequestException as e:
            raise RuntimeError(f"ZONOS2 request failed: {e}")

        if resp.status_code != 200:
            detail = resp.text[:500] if resp.text else f"HTTP {resp.status_code}"
            raise RuntimeError(f"ZONOS2 generation failed: {detail}")

        sample_rate = ZONOS2_SAMPLE_RATE
        try:
            sample_rate = int(resp.headers.get("X-Audio-Sample-Rate", ZONOS2_SAMPLE_RATE))
        except (TypeError, ValueError):
            pass

        audio = np.frombuffer(resp.content, dtype="<f4").astype(np.float32)
        if audio.size == 0:
            raise RuntimeError("ZONOS2 returned empty audio.")
        return audio, sample_rate

    @staticmethod
    def encode_reference_audio(path: str | Path) -> str:
        """Read an audio file and return its base64-encoded bytes."""
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")

    # ------------------------------------------------------------------ status

    def status(self) -> dict:
        running = self.is_server_running()
        launching = self._launching and not running
        # If the launcher process died before becoming ready, surface the error.
        if launching and self._process is not None and self._process.poll() is not None:
            launching = False
            self._launching = False
            if not self._last_error:
                self._last_error = "ZONOS2 server process exited during startup."
        return {
            "running": running,
            "launching": launching,
            "wsl_available": self.wsl_available(),
            "base_url": self._base_url(),
            "config": self.get_config(),
            "last_error": self._last_error,
        }

    def get_voices(self) -> list[dict]:
        """ZONOS2 has no fixed preset speakers; expose a single default voice.

        Cloned voices come from Sonotext voice profiles (reference clips).
        """
        return [
            {
                "id": "default",
                "name": "Default",
                "language": "Multi",
                "gender": "?",
            }
        ]


# Singleton instance
zonos2_manager = Zonos2Manager()
