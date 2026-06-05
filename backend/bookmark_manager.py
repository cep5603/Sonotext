import json
import logging
import threading
import tempfile
import shutil
import os
from typing import Dict, List

BOOKMARKS_FILE = os.path.join(os.path.dirname(__file__), "bookmarks.json")


class BookmarkManager:
    """Manages bookmarks for TTS generations, stored as a JSON file keyed by generation ID."""

    def __init__(self):
        self._lock = threading.Lock()
        self._ensure_setup()

    def _ensure_setup(self):
        if not os.path.exists(BOOKMARKS_FILE):
            self._save_all({})

    def _load_all(self) -> Dict[str, List[Dict]]:
        try:
            with open(BOOKMARKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_all(self, data: Dict[str, List[Dict]]):
        dir_path = os.path.dirname(BOOKMARKS_FILE)
        with tempfile.NamedTemporaryFile(
            "w", dir=dir_path, delete=False, suffix=".tmp", encoding="utf-8"
        ) as tmp:
            json.dump(data, tmp, indent=2)
            tmp_path = tmp.name
        shutil.move(tmp_path, BOOKMARKS_FILE)

    def get_bookmarks(self, generation_id: str) -> List[Dict]:
        data = self._load_all()
        return data.get(generation_id, [])

    def save_bookmarks(self, generation_id: str, bookmarks: List[Dict]):
        with self._lock:
            data = self._load_all()
            if bookmarks:
                data[generation_id] = bookmarks
            else:
                data.pop(generation_id, None)
            self._save_all(data)

    def delete_bookmarks(self, generation_id: str):
        with self._lock:
            data = self._load_all()
            if generation_id in data:
                del data[generation_id]
                self._save_all(data)


bookmark_manager = BookmarkManager()
