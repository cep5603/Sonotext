import os
import json
import logging
import uuid
import time
from datetime import datetime
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

    def _get_date_folder(self) -> str:
        """Get today's date folder name (YYYY-MM-DD)."""
        return datetime.now().strftime("%Y-%m-%d")

    def get_output_path_for_new_file(self, filename: str) -> str:
        """Get path for a new file, creating date subfolder if needed."""
        date_folder = self._get_date_folder()
        folder_path = os.path.join(OUTPUTS_DIR, date_folder)
        os.makedirs(folder_path, exist_ok=True)
        return os.path.join(folder_path, filename)

    def get_output_path(self, relative_path: str) -> str:
        """Get absolute path from a relative path (date_folder/filename or just filename for legacy)."""
        return os.path.join(OUTPUTS_DIR, relative_path)

    def add_entry(self, text: str, voice: str, speed: float, filename: str, duration: float) -> Dict:
        history = self._load_history()
        date_folder = self._get_date_folder()
        relative_path = f"{date_folder}/{filename}"
        
        entry = {
            "id": str(uuid.uuid4()),
            "text": text,
            "voice": voice,
            "speed": speed,
            "filename": relative_path,
            "duration": duration,
            "timestamp": time.time(),
            "url": f"/outputs/{relative_path}"
        }
        history.insert(0, entry)
        self._save_history(history)
        return entry

    def get_history(self) -> List[Dict]:
        return self._load_history()

    def delete_entry(self, entry_id: str):
        history = self._load_history()
        for entry in history:
            if entry["id"] == entry_id:
                filepath = self.get_output_path(entry["filename"])
                if os.path.exists(filepath):
                    try:
                        os.remove(filepath)
                        logging.info(f"Deleted file: {filepath}")
                    except Exception as e:
                        logging.error(f"Failed to delete file {filepath}: {e}")
                break
        history = [h for h in history if h["id"] != entry_id]
        self._save_history(history)
        
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

    def rename_entry(self, entry_id: str, new_name: str) -> Dict | None:
        """Rename a history entry, preserving UUID suffix."""
        import re
        
        # Sanitize the new name: remove invalid chars, collapse whitespace
        sanitized = re.sub(r'[\\/:*?"<>|]', '', new_name)
        sanitized = re.sub(r'\s+', '-', sanitized.strip())
        sanitized = re.sub(r'-+', '-', sanitized)  # Collapse multiple hyphens
        sanitized = sanitized.strip('-')  # Remove leading/trailing hyphens
        
        if not sanitized:
            return None  # Empty name after sanitization
        
        # Truncate to 100 chars
        sanitized = sanitized[:100]
        
        history = self._load_history()
        for entry in history:
            if entry["id"] == entry_id:
                old_filename = entry["filename"]
                old_path = self.get_output_path(old_filename)
                
                if not os.path.exists(old_path):
                    return None
                
                # Parse old filename: "YYYY-MM-DD/name-uuid.wav"
                parts = old_filename.split("/")
                date_folder = parts[0] if len(parts) > 1 else self._get_date_folder()
                basename = parts[-1]
                
                # Extract UUID suffix (last 8 hex chars before .wav)
                uuid_match = re.search(r'-([a-f0-9]{8})\.wav$', basename)
                if uuid_match:
                    uuid_suffix = uuid_match.group(1)
                else:
                    # No UUID found, generate new one
                    uuid_suffix = str(uuid.uuid4())[:8]
                
                # Build new filename
                new_filename_base = f"{sanitized}-{uuid_suffix}.wav"
                new_relative_path = f"{date_folder}/{new_filename_base}"
                new_path = self.get_output_path(new_relative_path)
                
                # Rename file on disk
                try:
                    os.rename(old_path, new_path)
                except Exception as e:
                    logging.error(f"Failed to rename file: {e}")
                    return None
                
                # Update entry
                entry["filename"] = new_relative_path
                entry["url"] = f"/outputs/{new_relative_path}"
                self._save_history(history)
                return entry
        
        return None

history_manager = HistoryManager()
