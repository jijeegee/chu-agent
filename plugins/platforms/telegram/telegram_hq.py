"""Opt-in HQ delegation. Transport identity, never a username, grants task authority."""
import re
import hashlib
import sqlite3
import unicodedata
from contextlib import closing

from chu_constants import get_chu_home


def task_envelope(message, configured_id):
    """Return (stable id, body) only for the configured real HQ sender."""
    user = getattr(message, "from_user", None)
    if (type(configured_id) is not int or configured_id <= 0
            or type(getattr(user, "id", None)) is not int or user.id != configured_id
            or getattr(user, "is_bot", None) is not True):
        return None
    text = getattr(message, "text", None)
    if any(getattr(message, name, None) for name in (
        "forward_origin", "forward_from", "forward_from_chat", "forward_date", "sender_chat",
        "is_automatic_forward", "via_bot", "caption", "photo", "video", "audio", "voice",
        "document", "animation", "sticker", "video_note", "contact", "location", "venue",
        "poll", "dice", "game", "invoice", "successful_payment", "media_group_id", "effective_attachment")):
        return None
    if getattr(getattr(message, "chat", None), "type", None) not in {"private", "group", "supergroup"}:
        return None
    if not isinstance(text, str) or len(text) > 4096:
        return None
    match = re.fullmatch(r"HQ_TASK ([A-Za-z0-9][A-Za-z0-9._-]{0,63})\n([\s\S]+)", text)
    if not match or not match[2].strip():
        return None
    return match[1], match[2]


def message_verdict(message, extra):
    """None leaves ordinary human/off-mode handling unchanged; bool gates HQ traffic."""
    if "hq_bot_id" not in extra:
        return None
    user = getattr(message, "from_user", None)
    if user is None:
        return False
    if getattr(user, "is_bot", False) or str(getattr(user, "id", "")) == str(extra["hq_bot_id"]):
        return task_envelope(message, extra["hq_bot_id"]) is not None
    return None


def claim_task(message, configured_id):
    """Commit before dispatch; claims are permanent, including after crashes.

    Scope: this Chu home + HQ bot, across all chats. Body dedup uses NFC and
    collapsed Unicode whitespace (case-sensitive). No task body is stored.
    This is at-most-once dispatch, not exactly-once execution or automatic retry.
    SQLite uniqueness arbitrates competing processes, with FULL sync durability.
    Errors propagate: unavailable/corrupt storage must never permit dispatch.
    """
    envelope = task_envelope(message, configured_id)
    if envelope is None:
        return False
    task_id, body = envelope
    normalized = " ".join(unicodedata.normalize("NFC", body).split())
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    home = get_chu_home()
    home.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(home / "telegram_hq_tasks.sqlite3", timeout=10)) as db:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("""CREATE TABLE IF NOT EXISTS claims (
            bot_id INTEGER NOT NULL, task_id TEXT NOT NULL,
            chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
            body_sha256 TEXT NOT NULL,
            claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (bot_id, task_id),
            UNIQUE (bot_id, chat_id, message_id), UNIQUE (bot_id, body_sha256)
        )""")
        with db:
            inserted = db.execute("""INSERT OR IGNORE INTO claims
                (bot_id, task_id, chat_id, message_id, body_sha256)
                VALUES (?, ?, ?, ?, ?)""",
                (configured_id, task_id, message.chat.id, message.message_id, digest))
        return inserted.rowcount == 1
