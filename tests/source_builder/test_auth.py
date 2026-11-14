"""NASA Earthdata credential loading tests; never contact NASA."""
import sys
import types

import pytest

from gradientdescentfarmers.source_builder.core import auth as auth_module


def _fake_earthaccess(monkeypatch, authenticated=True):
    calls = []
    def login(**kwargs):
        calls.append(kwargs)
        return types.SimpleNamespace(authenticated=authenticated)
    monkeypatch.setitem(sys.modules, "earthaccess", types.SimpleNamespace(login=login))
    return calls


def test_project_env_is_loaded_without_overwriting_shell(monkeypatch, tmp_path):
    root = tmp_path / "repo"
    project = root
    package = project / "gradientdescentfarmers" / "source_builder" / "core"
    package.mkdir(parents=True)
    (project / ".env").write_text(
        "EARTHDATA_USERNAME=local-user\nEARTHDATA_PASSWORD=local-secret\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(auth_module, "__file__", str(package / "auth.py"))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EARTHDATA_USERNAME", "shell-user")
    monkeypatch.delenv("EARTHDATA_PASSWORD", raising=False)
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)

    loaded = auth_module.load_project_env()

    assert project / ".env" in loaded
    assert auth_module.os.environ["EARTHDATA_USERNAME"] == "shell-user"
    assert auth_module.os.environ["EARTHDATA_PASSWORD"] == "local-secret"


def test_prefers_earthdata_environment_without_interactive_prompt(monkeypatch):
    monkeypatch.setattr(auth_module, "load_project_env", lambda: [])
    monkeypatch.setenv("EARTHDATA_USERNAME", "test-user")
    monkeypatch.setenv("EARTHDATA_PASSWORD", "test-password")
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    calls = _fake_earthaccess(monkeypatch)
    auth_module.login_earthdata()
    assert calls == [{"strategy": "environment"}]


def test_earthdata_token_uses_environment_strategy(monkeypatch):
    monkeypatch.setattr(auth_module, "load_project_env", lambda: [])
    monkeypatch.delenv("EARTHDATA_USERNAME", raising=False)
    monkeypatch.delenv("EARTHDATA_PASSWORD", raising=False)
    monkeypatch.setenv("EARTHDATA_TOKEN", "fake-token")
    calls = _fake_earthaccess(monkeypatch)
    auth_module.login_earthdata()
    assert calls == [{"strategy": "environment"}]


def test_missing_credentials_prompts_in_terminal(monkeypatch):
    monkeypatch.setattr(auth_module, "load_project_env", lambda: [])
    for key in ("EARTHDATA_USERNAME", "EARTHDATA_PASSWORD", "EARTHDATA_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(auth_module.sys, "stdin", types.SimpleNamespace(isatty=lambda: True))
    calls = _fake_earthaccess(monkeypatch)
    auth_module.login_earthdata()
    assert calls == [{}]


def test_missing_credentials_noninteractive_checks_netrc(monkeypatch):
    monkeypatch.setattr(auth_module, "load_project_env", lambda: [])
    for key in ("EARTHDATA_USERNAME", "EARTHDATA_PASSWORD", "EARTHDATA_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(auth_module.sys, "stdin", types.SimpleNamespace(isatty=lambda: False))
    calls = _fake_earthaccess(monkeypatch)
    auth_module.login_earthdata()
    assert calls == [{"strategy": "netrc"}]


def test_rejected_credentials_do_not_trigger_interactive_fallback(monkeypatch):
    monkeypatch.setattr(auth_module, "load_project_env", lambda: [])
    monkeypatch.setenv("EARTHDATA_USERNAME", "invalid")
    monkeypatch.setenv("EARTHDATA_PASSWORD", "invalid")
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    calls = _fake_earthaccess(monkeypatch, authenticated=False)
    with pytest.raises(PermissionError, match="NASA Earthdata authentication failed"):
        auth_module.login_earthdata()
    assert calls == [{"strategy": "environment"}]
