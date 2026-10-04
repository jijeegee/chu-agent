"""HQ task-only ingress; no Telegram/network calls, all state in temporary homes."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from datetime import datetime, timezone

from gateway.config import Platform, PlatformConfig
from gateway.authz_mixin import GatewayAuthorizationMixin
from plugins.platforms.telegram.adapter import TelegramAdapter

HQ = 7000000001  # fake HQ bot id
OWNER = "100001"  # fake owner user id


def message(text="HQ_TASK job-1\nSummarize the local report", *, sender=HQ, is_bot=True, mid=1, chat=123, **kwargs):
    fields = dict(message_id=mid, date=datetime.now(timezone.utc),
                  chat=SimpleNamespace(id=chat, type="private" if chat > 0 else "supergroup",
                                       title=None, full_name="HQ", is_forum=False),
                  from_user=SimpleNamespace(id=sender, full_name="HQ", username="HQ", is_bot=is_bot),
                  text=text, caption=None, message_thread_id=None, is_topic_message=False,
                  reply_to_message=None, quote=None, forum_topic_created=None, entities=[])
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def adapter(extra=None):
    return TelegramAdapter(PlatformConfig(enabled=True, extra={"hq_bot_id": HQ, **(extra or {})}))


def runner(a):
    r = GatewayAuthorizationMixin()
    r.adapters = {Platform.TELEGRAM: a}
    return r


def test_exact_hq_task_is_authorized_at_both_gates(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_USERS", OWNER)
    a = adapter({"allow_from": [OWNER]})
    m = message()
    assert a._is_user_authorized_from_message(m) is True
    assert a._should_process_message(m) is True
    assert runner(a)._is_user_authorized(a._source_from_message_for_auth(m)) is True


@pytest.mark.parametrize("chat", [123, -123])
@pytest.mark.parametrize("changes", [
    {"sender": 999}, {"sender": str(HQ)}, {"is_bot": None}, {"is_bot": 1},
    {"forward_origin": object()}, {"forward_from": object()},
    {"sender_chat": SimpleNamespace(id=HQ)}, {"from_user": None},
    {"photo": [object()]}, {"caption": "hidden"}, {"document": object()},
    {"effective_attachment": object()},
    {"text": "HQ_RESULT job-1\ndone"}, {"text": "ACK job-1"},
    {"text": "/approve"}, {"text": "yes"},
    {"text": "HQ_TASK job-1\n"}, {"text": "HQ_TASK job-1\n" + "x" * 4096},
])
def test_untrusted_or_non_task_cannot_cross_any_gate(monkeypatch, chat, changes):
    monkeypatch.setenv("TELEGRAM_ALLOW_BOTS", "all")
    monkeypatch.setenv("GATEWAY_ALLOW_ALL_USERS", "true")
    a = adapter({"free_response_chats": [str(chat)]})
    m = message(chat=chat, **changes)
    assert a._should_process_message(m) is False
    assert a._is_user_authorized_from_message(m) is False
    assert runner(a)._is_user_authorized(a._source_from_message_for_auth(m)) is False


def test_human_access_and_default_off_are_unchanged(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_USERS", OWNER)
    a = adapter()
    human = message("ordinary conversation", sender=int(OWNER), is_bot=False)
    assert a._is_user_authorized_from_message(human) is True
    assert runner(a)._is_user_authorized(a._source_from_message_for_auth(human)) is True
    stranger = message("hello", sender=int(OWNER) + 1, is_bot=False)
    assert a._is_user_authorized_from_message(stranger) is False
    assert runner(a)._is_user_authorized(a._source_from_message_for_auth(stranger)) is False
    off = TelegramAdapter(PlatformConfig(enabled=True))
    assert runner(off)._is_user_authorized(off._source_from_message_for_auth(message())) is False


def test_bare_source_and_callback_cannot_claim_task_authority(monkeypatch):
    from gateway.session import SessionSource
    monkeypatch.setenv("TELEGRAM_ALLOW_BOTS", "all")
    monkeypatch.setenv("GATEWAY_ALLOW_ALL_USERS", "true")
    a = adapter()
    assert runner(a)._is_user_authorized(SessionSource(platform=Platform.TELEGRAM,
        chat_id="123", user_id=str(HQ), is_bot=True)) is False
    assert a._is_callback_user_authorized(str(HQ), chat_id="123") is False


@pytest.mark.asyncio
async def test_task_dispatch_is_durable_and_never_gateway_control(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    dispatched = []
    for m in [message(), message(),
              message("HQ_TASK job-1\nChanged instructions", mid=2),
              message("HQ_TASK job-2\nSummarize  the local\nreport", mid=3),
              message("HQ_TASK job-3\nDifferent task", mid=1),
              message("HQ_TASK job-4\nyes", mid=4)]:
        a = adapter()
        a.handle_message = AsyncMock(side_effect=dispatched.append)
        a._enqueue_text_event = lambda event: pytest.fail("HQ tasks must not enter text batching")
        await a._handle_text_message(SimpleNamespace(effective_message=m, message=m, update_id=1), None)
    assert len(dispatched) == 2
    event = dispatched[0]
    assert event.text == message().text
    assert event.allow_gateway_control is False
    assert event.metadata["hq_task_id"] == "job-1"
    assert runner(a)._is_user_authorized(event.source) is True
    assert event.channel_prompt and "delegated" in event.channel_prompt
    from gateway.run_busy import GatewayBusySessionMixin
    busy = object.__new__(GatewayBusySessionMixin)
    busy._handle_approve_command = AsyncMock()
    event.text = "yes"  # Even accidental downstream rewriting cannot approve.
    assert await busy._route_plaintext_approval_while_busy(event, "test-session") is False
    event.text = "/approve"
    assert event.is_command() is False
    busy._handle_approve_command.assert_not_called()


@pytest.mark.asyncio
async def test_task_preserves_channel_policy(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    a = adapter({"channel_prompts": {"123": "Keep the channel safety policy."}})
    a.handle_message = AsyncMock()
    m = message()
    await a._handle_text_message(SimpleNamespace(effective_message=m, message=m, update_id=1), None)
    event = a.handle_message.call_args.args[0]
    assert "Keep the channel safety policy." in event.channel_prompt


@pytest.mark.asyncio
async def test_other_bot_callback_is_silent_even_with_broad_allow(monkeypatch):
    monkeypatch.setenv("GATEWAY_ALLOW_ALL_USERS", "true")
    a = adapter()
    a._handle_exec_approval_callback = AsyncMock()
    query = SimpleNamespace(from_user=SimpleNamespace(id=999, is_bot=True),
                            data="ea:once:1", answer=AsyncMock(),
                            message=SimpleNamespace(chat_id=123))
    await a._handle_callback_query(SimpleNamespace(callback_query=query), None)
    query.answer.assert_not_called()
    a._handle_exec_approval_callback.assert_not_called()


def test_sqlite_claim_is_atomic_across_connections(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from plugins.platforms.telegram.telegram_hq import claim_task
    import sqlite3
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(lambda _: claim_task(message(), HQ), range(16)))
    assert sum(outcomes) == 1
    with sqlite3.connect(tmp_path / "telegram_hq_tasks.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM claims").fetchone()[0] == 1
    assert not claim_task(message("HQ_TASK another-id\nSummarize the local report", chat=-999, mid=9), HQ)


@pytest.mark.asyncio
async def test_crash_after_claim_does_not_retry(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    m = message()
    update = SimpleNamespace(effective_message=m, message=m, update_id=1)
    a = adapter()
    a.handle_message = AsyncMock(side_effect=RuntimeError("simulated dispatch crash"))
    with pytest.raises(RuntimeError, match="simulated dispatch crash"):
        await a._handle_text_message(update, None)
    fresh = adapter()
    fresh.handle_message = AsyncMock()
    await fresh._handle_text_message(update, None)
    fresh.handle_message.assert_not_called()


def test_nested_extra_config_reaches_real_adapter(tmp_path, monkeypatch):
    from gateway.config import load_gateway_config
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text(f"telegram:\n  extra:\n    hq_bot_id: {HQ}\n", encoding="utf-8")
    config = load_gateway_config()
    a = TelegramAdapter(config.platforms[Platform.TELEGRAM])
    assert a._is_user_authorized_from_message(message()) is True


def test_real_telegram_sdk_ingress_in_fresh_process(tmp_path, monkeypatch):
    """The suite stubs telegram in-process; probe real PTB without its test stubs."""
    import subprocess
    import sys
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    probe = f"HQ = {HQ}\n" + r'''
import asyncio
from telegram import Message
from types import SimpleNamespace
from gateway.config import Platform, PlatformConfig
from gateway.authz_mixin import GatewayAuthorizationMixin
from plugins.platforms.telegram.adapter import TelegramAdapter
m = Message.de_json({"message_id": 1, "date": 1,
    "chat": {"id": 123, "type": "private"},
    "from": {"id": HQ, "is_bot": True, "first_name": "HQ"},
    "text": "HQ_TASK real-sdk-1\nInspect the report"}, None)
assert type(m).__name__ == "Message"
events = []
async def capture(event):
    events.append(event)
async def main():
    for _ in range(2):
        a = TelegramAdapter(PlatformConfig(extra={"hq_bot_id": HQ}))
        a.handle_message = capture
        r = GatewayAuthorizationMixin()
        r.adapters = {Platform.TELEGRAM: a}
        assert a._is_user_authorized_from_message(m)
        assert r._is_user_authorized(a._source_from_message_for_auth(m))
        await a._handle_text_message(SimpleNamespace(effective_message=m, update_id=1), None)
    assert len(events) == 1
    assert events[0].text == m.text
    assert events[0].allow_gateway_control is False
    assert r._is_user_authorized(events[0].source)
asyncio.run(main())
'''
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr


@pytest.mark.asyncio
async def test_corrupt_claim_store_fails_closed(tmp_path, monkeypatch):
    import sqlite3
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "telegram_hq_tasks.sqlite3").write_bytes(b"not a sqlite database")
    a = adapter()
    a.handle_message = AsyncMock()
    m = message()
    with pytest.raises(sqlite3.DatabaseError):
        await a._handle_text_message(SimpleNamespace(effective_message=m, update_id=1), None)
    a.handle_message.assert_not_called()
