from typer.testing import CliRunner

from golesync_agent.cli import app

runner = CliRunner()


def test_init_creates_files(tmp_path, monkeypatch):
    monkeypatch.setenv("GOLESYNC_CONFIG_DIR", str(tmp_path / "c"))
    monkeypatch.setenv("GOLESYNC_DATA_DIR", str(tmp_path / "d"))
    r = runner.invoke(app, ["init"])
    assert r.exit_code == 0
    assert (tmp_path / "c" / "config.yaml").exists()
    assert (tmp_path / "c" / "commands.yaml").exists()
    assert oct((tmp_path / "c" / "token").stat().st_mode & 0o777) == "0o600"


def test_rotate_token_changes_token(tmp_path, monkeypatch):
    monkeypatch.setenv("GOLESYNC_CONFIG_DIR", str(tmp_path / "c"))
    monkeypatch.setenv("GOLESYNC_DATA_DIR", str(tmp_path / "d"))
    runner.invoke(app, ["init"])
    before = (tmp_path / "c" / "token").read_text()
    r = runner.invoke(app, ["rotate-token"])
    assert r.exit_code == 0 and (tmp_path / "c" / "token").read_text() != before


def test_pause_without_agent_fails_cleanly(tmp_path, monkeypatch):
    monkeypatch.setenv("GOLESYNC_CONFIG_DIR", str(tmp_path / "c"))
    monkeypatch.setenv("GOLESYNC_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setattr("golesync_agent.config.Settings.port", 1, raising=False)
    r = runner.invoke(app, ["pause"])
    assert r.exit_code == 1


def test_gsync_alias_declared():
    import tomllib
    from pathlib import Path

    scripts = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())["project"]["scripts"]
    assert scripts["gsync"] == scripts["golesync"]
