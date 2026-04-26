import os
import json
import logging
import uuid
import time
import threading
import tempfile
import shutil
from typing import List, Dict, Optional
from paths import writable_path

PROJECTS_FILE = str(writable_path("projects.json"))

logger = logging.getLogger(__name__)


class ProjectManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._ensure_setup()

    def _ensure_setup(self):
        if not os.path.exists(PROJECTS_FILE):
            self._save_projects([])

    def _load_projects(self) -> List[Dict]:
        try:
            with open(PROJECTS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return []

    def _save_projects(self, projects: List[Dict]):
        dir_path = os.path.dirname(PROJECTS_FILE)
        with tempfile.NamedTemporaryFile('w', dir=dir_path, delete=False, suffix='.tmp', encoding='utf-8') as tmp:
            json.dump(projects, tmp, indent=2)
            tmp_path = tmp.name
        shutil.move(tmp_path, PROJECTS_FILE)

    # CRUD

    def list_projects(self) -> List[Dict]:
        with self._lock:
            return self._load_projects()

    def get_project(self, project_id: str) -> Optional[Dict]:
        with self._lock:
            projects = self._load_projects()
            return next((p for p in projects if p["id"] == project_id), None)

    def create_project(self, name: str) -> Dict:
        with self._lock:
            projects = self._load_projects()
            project = {
                "id": str(uuid.uuid4()),
                "name": name.strip(),
                "color": None,
                "generation_ids": [],
                "created_at": time.time(),
            }
            projects.insert(0, project)
            self._save_projects(projects)
            return project

    def rename_project(self, project_id: str, name: str) -> Optional[Dict]:
        with self._lock:
            projects = self._load_projects()
            for p in projects:
                if p["id"] == project_id:
                    p["name"] = name.strip()
                    self._save_projects(projects)
                    return p
            return None

    def update_project_color(self, project_id: str, color: Optional[str]) -> Optional[Dict]:
        with self._lock:
            projects = self._load_projects()
            for p in projects:
                if p["id"] == project_id:
                    p["color"] = color
                    self._save_projects(projects)
                    return p
            return None

    def delete_project(self, project_id: str) -> bool:
        with self._lock:
            projects = self._load_projects()
            original_len = len(projects)
            projects = [p for p in projects if p["id"] != project_id]
            if len(projects) < original_len:
                self._save_projects(projects)
                return True
            return False

    # Generation tagging

    def add_generation(self, project_id: str, generation_id: str) -> Optional[Dict]:
        with self._lock:
            projects = self._load_projects()
            for p in projects:
                if p["id"] == project_id:
                    if generation_id not in p["generation_ids"]:
                        p["generation_ids"].append(generation_id)
                        self._save_projects(projects)
                    return p
            return None

    def remove_generation(self, project_id: str, generation_id: str) -> Optional[Dict]:
        with self._lock:
            projects = self._load_projects()
            for p in projects:
                if p["id"] == project_id:
                    if generation_id in p["generation_ids"]:
                        p["generation_ids"].remove(generation_id)
                        self._save_projects(projects)
                    return p
            return None

    def get_projects_for_generation(self, generation_id: str) -> List[Dict]:
        with self._lock:
            projects = self._load_projects()
            return [p for p in projects if generation_id in p.get("generation_ids", [])]

    def reorder_projects(self, ordered_ids: List[str]) -> List[Dict]:
        with self._lock:
            projects = self._load_projects()
            id_to_project = {p["id"]: p for p in projects}
            reordered = [id_to_project[pid] for pid in ordered_ids if pid in id_to_project]
            # Append any projects not in the ordered list (shouldn't happen, but safety)
            seen = set(ordered_ids)
            for p in projects:
                if p["id"] not in seen:
                    reordered.append(p)
            self._save_projects(reordered)
            return reordered

    def reorder_generations(self, project_id: str, ordered_ids: List[str]) -> Optional[Dict]:
        with self._lock:
            projects = self._load_projects()
            for p in projects:
                if p["id"] == project_id:
                    existing = set(p["generation_ids"])
                    reordered = [gid for gid in ordered_ids if gid in existing]
                    # Append any not in ordered list (safety)
                    for gid in p["generation_ids"]:
                        if gid not in set(ordered_ids):
                            reordered.append(gid)
                    p["generation_ids"] = reordered
                    self._save_projects(projects)
                    return p
            return None


project_manager = ProjectManager()
