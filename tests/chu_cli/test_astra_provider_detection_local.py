"""Local regression test (JIHO's machine, 2026-10-02): a bare Astra id re-selected on an
OpenAI-backed provider must stay there instead of being re-routed to OpenRouter."""
from chu_cli.models import detect_provider_for_model


def test_bare_astra_stays_on_openai_backed_providers():
    for provider in ("openai-codex", "openai", "openai-api"):
        assert detect_provider_for_model("gpt-6-astra", provider) is None
        assert detect_provider_for_model("gpt-6-astra-900k", provider) is None


def test_astra_elsewhere_still_routes_to_openrouter():
    assert detect_provider_for_model("gpt-6-astra", "nous") == ("openrouter", "openai/gpt-6-astra")
    assert detect_provider_for_model("openai/gpt-6-astra", "openai-codex") == ("openrouter", "openai/gpt-6-astra")
