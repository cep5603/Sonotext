import os
import sys
from pathlib import Path


def is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_data_dir() -> Path:
    override = os.environ.get("SONOTEXT_DATA_DIR")
    if override:
        return Path(override)

    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if root:
            return Path(root) / "Sonotext" / "backend"

    return Path.home() / ".sonotext" / "backend"


def source_dir() -> Path:
    return Path(__file__).resolve().parent


def writable_root() -> Path:
    return app_data_dir() if is_packaged() else source_dir()


def ensure_writable_root() -> Path:
    root = writable_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def writable_path(*parts: str) -> Path:
    return ensure_writable_root().joinpath(*parts)
