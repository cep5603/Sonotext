"""Shared language and voice mapping helpers for the backend."""

KOKORO_LANG_LABELS = {
    'a': 'American English',
    'b': 'British English',
    'j': 'Japanese',
    'z': 'Mandarin Chinese',
    'e': 'Spanish',
    'f': 'French',
    'h': 'Hindi',
    'i': 'Italian',
    'p': 'Portuguese',
}

KOKORO_VOICE_PREFIX_TO_ALIGNMENT_LANGUAGE = {
    'a': 'eng',
    'b': 'eng',
    'j': 'jpn',
    'z': 'cmn',
    'e': 'spa',
    'f': 'fra',
    'h': 'hin',
    'i': 'ita',
    'p': 'por',
}

ESPEAK_TO_KOKORO_LANGUAGE = {
    'en-us': 'a',
    'en-gb': 'b',
    'es': 'e',
    'fr-fr': 'f',
    'hi': 'h',
    'it': 'i',
    'ja': 'j',
    'pt-br': 'p',
    'zh': 'z',
    'zh-cn': 'z',
}

LANGUAGE_NAME_TO_ISO6393 = {
    'en': 'eng',
    'eng': 'eng',
    'english': 'eng',
    'es': 'spa',
    'spa': 'spa',
    'spanish': 'spa',
    'fr': 'fra',
    'fra': 'fra',
    'fre': 'fra',
    'french': 'fra',
    'de': 'deu',
    'deu': 'deu',
    'ger': 'deu',
    'german': 'deu',
    'it': 'ita',
    'ita': 'ita',
    'italian': 'ita',
    'pt': 'por',
    'por': 'por',
    'portuguese': 'por',
    'ja': 'jpn',
    'jpn': 'jpn',
    'japanese': 'jpn',
    'zh': 'cmn',
    'cmn': 'cmn',
    'zh-cn': 'cmn',
    'zh-hans': 'cmn',
    'mandarin': 'cmn',
    'hi': 'hin',
    'hin': 'hin',
    'hindi': 'hin',
    'ko': 'kor',
    'kor': 'kor',
    'korean': 'kor',
    'ru': 'rus',
    'rus': 'rus',
    'russian': 'rus',
    # ZONOS2 language codes (locale-style identifiers)
    'en_us': 'eng',
    'en_gb': 'eng',
    'fr_fr': 'fra',
    'pt_br': 'por',
}

ISO6393_TO_WHISPER_LANGUAGE = {
    'eng': 'en',
    'cmn': 'zh',
    'deu': 'de',
    'fra': 'fr',
    'hin': 'hi',
    'ita': 'it',
    'jpn': 'ja',
    'kor': 'ko',
    'por': 'pt',
    'rus': 'ru',
    'spa': 'es',
}


def get_kokoro_language_code(voice: str | None) -> str:
    """Map a Kokoro voice id to the corresponding pipeline language code."""
    if voice:
        return voice[0].lower() if voice[0].lower() in KOKORO_LANG_LABELS else 'a'
    return 'a'


def resolve_kokoro_language_code(voice: str | None, lang_override: str | None = None) -> str:
    """Resolve a Kokoro pipeline language code from an optional override and voice id."""
    if lang_override:
        return ESPEAK_TO_KOKORO_LANGUAGE.get(
            lang_override.strip().lower(),
            get_kokoro_language_code(voice),
        )
    return get_kokoro_language_code(voice)


def get_alignment_language_code_from_voice(voice: str | None) -> str:
    """Map a Kokoro voice id to an ISO-639-3 language code for alignment."""
    if voice:
        return KOKORO_VOICE_PREFIX_TO_ALIGNMENT_LANGUAGE.get(voice[0].lower(), 'eng')
    return 'eng'


def normalize_language_code(language: str | None) -> str:
    """Normalize common language identifiers to ISO-639-3 codes."""
    if not language:
        return 'eng'

    normalized = language.strip().lower()
    if not normalized or normalized == 'auto':
        return 'eng'

    if normalized in LANGUAGE_NAME_TO_ISO6393:
        return LANGUAGE_NAME_TO_ISO6393[normalized]

    if len(normalized) == 3:
        return normalized

    return 'eng'


def map_language_to_whisper_language(language: str | None) -> str:
    """Map a language identifier to the two-letter language code Whisper expects."""
    return ISO6393_TO_WHISPER_LANGUAGE.get(normalize_language_code(language), 'en')
