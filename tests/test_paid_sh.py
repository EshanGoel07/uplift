"""Tests for scripts/paid.sh against the real budget proxy and a fake `uplift` binary.
No real key and no model calls."""

import json
import os
import socket
import stat
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PAID = ROOT / "scripts" / "paid.sh"
PROXY_PY = ROOT / "tools" / "budget_guard" / "budget_proxy.py"
SECRET = "sk-TEST-SECRET-123456"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def env(tmp_path):
    keyf = tmp_path / "meta.key"
    keyf.write_text(SECRET)
    keyf.chmod(0o600)
    fake = tmp_path / "uplift"
    out = tmp_path / "fake_out.json"
    fake.write_text(f"#!{sys.executable}\nimport json, os, sys\n"
                    f"json.dump({{'args': sys.argv[1:], 'key_present': bool(os.environ.get('META_API_KEY')),"
                    f" 'key_ok': os.environ.get('META_API_KEY') == {SECRET!r}}}, open({str(out)!r}, 'w'))\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    port = free_port()
    ledger = tmp_path / "ledger"
    ledger.mkdir()
    return {"key": keyf, "fake": fake, "out": out, "port": port, "ledger": ledger, "tmp": tmp_path}


def start_proxy(e, cap="10"):
    p = subprocess.Popen([sys.executable, str(PROXY_PY), "--cap", cap, "--port", str(e["port"]),
                          "--ledger-dir", str(e["ledger"])], env=dict(os.environ, META_API_KEY="X"),
                         stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{e['port']}/__budget", timeout=1)
            return p
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("proxy did not start")


REAL_LOG = ROOT / "runs" / "paid.log"


def run(e, *args, extra_env=None):
    # UPLIFT_PAID_LOG_DIR: tests must never write into the real runs/paid.log
    env = dict(os.environ, UPLIFT_KEY_FILE=str(e["key"]), UPLIFT_PROXY=f"http://127.0.0.1:{e['port']}",
               UPLIFT_BIN=str(e["fake"]), UPLIFT_PAID_LOG_DIR=str(e["tmp"] / "logs"), **(extra_env or {}))
    env.pop("META_API_KEY", None)
    return subprocess.run(["bash", str(PAID), *args], capture_output=True, text=True, env=env)


def test_refuses_other_commands_and_dangerous_flags(env):
    assert run(env, "validate", "--task", "x").returncode == 2
    assert run(env, "run-one", "--agent-cmd", "env").returncode == 2
    assert run(env, "run-one", "--guard=/tmp/evil.py").returncode == 2
    assert not env["out"].exists()


def test_refuses_when_proxy_down(env):
    r = run(env, "run-one", "--task", "x")
    assert r.returncode == 4 and "not reachable" in r.stderr and not env["out"].exists()


def test_happy_path_passes_key_without_printing_it(env):
    p = start_proxy(env)
    try:
        r = run(env, "run-one", "--task", "t1", "--seed", "2")
        assert r.returncode == 0, r.stderr
        got = json.loads(env["out"].read_text())
        assert got["args"] == ["run-one", "--task", "t1", "--seed", "2"]
        assert got["key_present"] and got["key_ok"]
        assert SECRET not in r.stdout + r.stderr
        log = (env["tmp"] / "logs" / "paid.log").read_text()
        assert "run-one --task t1 --seed 2" in log and SECRET not in log
    finally:
        p.terminate()


def test_generate_never_gets_the_key_and_probe_does(env):
    p = start_proxy(env)
    try:
        r = run(env, "generate", "--repo", "o/r")
        assert r.returncode == 0, r.stderr
        got = json.loads(env["out"].read_text())
        assert got["args"] == ["generate", "--repo", "o/r"] and not got["key_present"]
        r = run(env, "probe-hooks")
        assert r.returncode == 0, r.stderr
        assert json.loads(env["out"].read_text())["key_ok"]
        assert run(env, "generate", "--guard=/tmp/evil.py").returncode == 2
        for cmd in ("screen", "tune", "label"):
            r = run(env, cmd, "--repo", "o/r")
            assert r.returncode == 0, r.stderr
            got = json.loads(env["out"].read_text())
            assert got["args"] == [cmd, "--repo", "o/r"] and not got["key_present"]
            assert run(env, cmd, "--agent-cmd=x").returncode == 2
    finally:
        p.terminate()


def test_refuses_when_budget_nearly_exhausted(env):
    p = start_proxy(env, cap="1")  # remaining $1 < $2 minimum
    try:
        r = run(env, "run-one", "--task", "x")
        assert r.returncode == 3 and not env["out"].exists()
    finally:
        p.terminate()


def test_refuses_world_readable_key(env):
    p = start_proxy(env)
    try:
        env["key"].chmod(0o644)
        r = run(env, "run-one", "--task", "x")
        assert r.returncode == 5 and "permissions" in r.stderr and not env["out"].exists()
    finally:
        p.terminate()


def test_tests_never_touch_the_real_paid_log(env):
    before = REAL_LOG.read_bytes() if REAL_LOG.exists() else None
    p = start_proxy(env)
    try:
        for cmd in (["run-one", "--task", "t1"], ["generate", "--repo", "o/r"], ["probe-hooks"]):
            assert run(env, *cmd).returncode == 0
    finally:
        p.terminate()
    assert (REAL_LOG.read_bytes() if REAL_LOG.exists() else None) == before
    assert len((env["tmp"] / "logs" / "paid.log").read_text().splitlines()) == 3
