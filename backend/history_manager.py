import os
import json
import logging
import uuid
import time
from typing import List, Dict

OUTPUTS_DIR = os.path.join(os.path.dirname(__file__), "outputs")
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "history.json")

class HistoryManager:
    def __init__(self):
        self.ensure_setup()

    def ensure_setup(self):
        os.makedirs(OUTPUTS_DIR, exist_ok=True)
        if not os.path.exists(HISTORY_FILE):
            self._save_history([])

    def _load_history(self) -> List[Dict]:
        try:
            with open(HISTORY_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return []

    def _save_history(self, history: List[Dict]):
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)

    def add_entry(self, text: str, voice: str, speed: float, filename: str, duration: float) -> Dict:
        history = self._load_history()
        entry = {
            "id": str(uuid.uuid4()),
            "text": text,
            "voice": voice,
            "speed": speed,
            "filename": filename,
            "duration": duration,  # Duration in seconds
            "timestamp": time.time(),
            "url": f"/outputs/{filename}" # Relative URL for frontend
        }
        # Prepend to keep newest first
        history.insert(0, entry)
        self._save_history(history)
        return entry

    def get_history(self) -> List[Dict]:
        return self._load_history()

    def delete_entry(self, entry_id: str):
        history = self._load_history()
        history = [h for h in history if h["id"] != entry_id]
        self._save_history(history)
        
    def get_output_path(self, filename: str) -> str:
        return os.path.join(OUTPUTS_DIR, filename)
    
    def update_missing_durations(self):
        """Calculate and update duration for entries missing it."""
        import soundfile as sf
        history = self._load_history()
        updated = False
        
        for entry in history:
            if entry.get("duration") is None:
                filepath = self.get_output_path(entry["filename"])
                if os.path.exists(filepath):
                    try:
                        info = sf.info(filepath)
                        entry["duration"] = info.duration
                        updated = True
                    except Exception:
                        pass
        
        if updated:
            self._save_history(history)
        return updated

history_manager = HistoryManager()
