"""
Voice Profile Manager

Manages saved voice profiles for Qwen3-TTS voice cloning.
Each profile contains a reference audio and metadata for consistent voice generation.
"""

import json
import os
import uuid
import time
import logging
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional
import numpy as np
import soundfile as sf
from paths import writable_path

logger = logging.getLogger("VoiceProfileManager")

# Default reference text for voice design (~10 seconds)
DEFAULT_REFERENCE_TEXT = (
    "Hello, and welcome. This is a sample of my speaking voice. "
    "I hope it sounds natural, clear, and easy to listen to. "
    "Thank you for taking the time to hear this."
)


@dataclass
class VoiceProfile:
    """A saved voice profile for voice cloning."""
    id: str
    name: str
    description: str  # Voice design instruction (empty for uploaded audio)
    reference_text: str  # Transcript of reference audio
    language: str
    source: str  # "designed" or "uploaded"
    created_at: float

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "VoiceProfile":
        """Create from dict."""
        return cls(**data)


class VoiceProfileManager:
    """Manages voice profiles stored on disk."""

    def __init__(self, profiles_dir: str | Path = None):
        """
        Initialize the voice profile manager.

        Args:
            profiles_dir: Directory to store voice profiles.
                         Defaults to backend/voice_profiles
        """
        if profiles_dir is None:
            # Default to voice_profiles directory next to this file
            profiles_dir = writable_path("voice_profiles")
        
        self.profiles_dir = Path(profiles_dir)
        self.profiles_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"VoiceProfileManager initialized. Profiles dir: {self.profiles_dir}")

    def _get_profile_dir(self, profile_id: str) -> Path:
        """Get the directory for a specific profile."""
        return self.profiles_dir / profile_id

    def _get_profile_json_path(self, profile_id: str) -> Path:
        """Get the profile.json path for a profile."""
        return self._get_profile_dir(profile_id) / "profile.json"

    def _get_reference_audio_path(self, profile_id: str) -> Path:
        """Get the reference.wav path for a profile."""
        return self._get_profile_dir(profile_id) / "reference.wav"

    def list_profiles(self) -> list[VoiceProfile]:
        """List all saved voice profiles."""
        profiles = []
        
        if not self.profiles_dir.exists():
            return profiles
        
        for profile_dir in self.profiles_dir.iterdir():
            if not profile_dir.is_dir():
                continue
            
            profile_json = profile_dir / "profile.json"
            if profile_json.exists():
                try:
                    with open(profile_json, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    profiles.append(VoiceProfile.from_dict(data))
                except Exception as e:
                    logger.warning(f"Failed to load profile from {profile_json}: {e}")
        
        # Sort by user-defined order, fallback to creation time
        order = self.load_order()
        if order:
            order_map = {pid: i for i, pid in enumerate(order)}
            # Profiles in order come first, then rest by creation time (newest first)
            profiles.sort(key=lambda p: (order_map.get(p.id, len(order)), -p.created_at))
        else:
            profiles.sort(key=lambda p: p.created_at, reverse=True)
        return profiles

    def load_order(self) -> list[str]:
        """Load the user-defined profile display order."""
        order_path = self.profiles_dir / "order.json"
        if order_path.exists():
            try:
                with open(order_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load order file: {e}")
        return []

    def save_order(self, profile_ids: list[str]) -> None:
        """Save the user-defined profile display order."""
        order_path = self.profiles_dir / "order.json"
        with open(order_path, "w", encoding="utf-8") as f:
            json.dump(profile_ids, f)
        logger.info(f"Saved voice profile order: {len(profile_ids)} profiles")

    def rename_profile(self, profile_id: str, new_name: str) -> Optional[VoiceProfile]:
        """Rename a voice profile."""
        profile = self.get_profile(profile_id)
        if not profile:
            return None
        
        # Update the profile name
        profile.name = new_name
        
        # Save updated metadata
        profile_json = self._get_profile_json_path(profile_id)
        with open(profile_json, "w", encoding="utf-8") as f:
            json.dump(profile.to_dict(), f, indent=2)
        
        logger.info(f"Renamed voice profile {profile_id} to '{new_name}'")
        return profile

    def get_profile(self, profile_id: str) -> Optional[VoiceProfile]:
        """Get a specific voice profile by ID."""
        profile_json = self._get_profile_json_path(profile_id)
        
        if not profile_json.exists():
            return None
        
        try:
            with open(profile_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            return VoiceProfile.from_dict(data)
        except Exception as e:
            logger.error(f"Failed to load profile {profile_id}: {e}")
            return None

    def get_reference_audio(self, profile_id: str) -> tuple[np.ndarray, int] | None:
        """
        Load the reference audio for a profile.

        Returns:
            Tuple of (audio_data, sample_rate) or None if not found.
        """
        audio_path = self._get_reference_audio_path(profile_id)
        
        if not audio_path.exists():
            return None
        
        try:
            audio, sr = sf.read(audio_path, dtype="float32")
            return audio, sr
        except Exception as e:
            logger.error(f"Failed to load reference audio for {profile_id}: {e}")
            return None

    def create_from_design(
        self,
        name: str,
        description: str,
        reference_audio: np.ndarray,
        sample_rate: int,
        reference_text: str = DEFAULT_REFERENCE_TEXT,
        language: str = "Auto",
    ) -> VoiceProfile:
        """
        Create a voice profile from Voice Design output.

        Args:
            name: User-friendly name for the voice
            description: Voice design instruction used to create it
            reference_audio: Generated reference audio (numpy array)
            sample_rate: Sample rate of the audio
            reference_text: Transcript of the reference audio
            language: Primary language of the voice

        Returns:
            The created VoiceProfile
        """
        profile_id = str(uuid.uuid4())
        profile_dir = self._get_profile_dir(profile_id)
        profile_dir.mkdir(parents=True, exist_ok=True)

        # Save reference audio
        audio_path = self._get_reference_audio_path(profile_id)
        sf.write(audio_path, reference_audio, sample_rate)

        # Create profile
        profile = VoiceProfile(
            id=profile_id,
            name=name,
            description=description,
            reference_text=reference_text,
            language=language,
            source="designed",
            created_at=time.time(),
        )

        # Save profile metadata
        profile_json = self._get_profile_json_path(profile_id)
        with open(profile_json, "w", encoding="utf-8") as f:
            json.dump(profile.to_dict(), f, indent=2)

        logger.info(f"Created voice profile '{name}' (id={profile_id}, source=designed)")
        return profile

    def create_from_upload(
        self,
        name: str,
        audio_data: bytes,
        transcript: str,
        language: str = "Auto",
    ) -> VoiceProfile:
        """
        Create a voice profile from uploaded audio.

        Args:
            name: User-friendly name for the voice
            audio_data: Raw audio file bytes (WAV or MP3)
            transcript: Transcript of what is said in the audio
            language: Primary language of the voice

        Returns:
            The created VoiceProfile
        """
        import io

        profile_id = str(uuid.uuid4())
        profile_dir = self._get_profile_dir(profile_id)
        profile_dir.mkdir(parents=True, exist_ok=True)

        # Load uploaded audio to numpy
        audio_buffer = io.BytesIO(audio_data)
        try:
            audio, sr = sf.read(audio_buffer, dtype="float32")
        except Exception as e:
            raise ValueError(f"Failed to read audio file: {e}")

        # Ensure mono
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        # Save as WAV
        audio_path = self._get_reference_audio_path(profile_id)
        sf.write(audio_path, audio, sr)

        # Create profile
        profile = VoiceProfile(
            id=profile_id,
            name=name,
            description="",  # No description for uploaded audio
            reference_text=transcript,
            language=language,
            source="uploaded",
            created_at=time.time(),
        )

        # Save profile metadata
        profile_json = self._get_profile_json_path(profile_id)
        with open(profile_json, "w", encoding="utf-8") as f:
            json.dump(profile.to_dict(), f, indent=2)

        logger.info(f"Created voice profile '{name}' (id={profile_id}, source=uploaded)")
        return profile

    def delete_profile(self, profile_id: str) -> bool:
        """
        Delete a voice profile.

        Args:
            profile_id: ID of the profile to delete

        Returns:
            True if deleted, False if not found
        """
        import shutil

        profile_dir = self._get_profile_dir(profile_id)
        
        if not profile_dir.exists():
            return False
        
        try:
            shutil.rmtree(profile_dir)
            logger.info(f"Deleted voice profile {profile_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete profile {profile_id}: {e}")
            return False


# Singleton instance
voice_profile_manager = VoiceProfileManager()
