"""Regression tests for symlink-safe Docker stage2 ownership repair."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
STAGE2_HOOK = REPO_ROOT / "docker" / "stage2-hook.sh"


@pytest.fixture(scope="module")
def stage2_text() -> str:
    if not STAGE2_HOOK.exists():
        pytest.skip("docker/stage2-hook.sh not present in this checkout")
    return STAGE2_HOOK.read_text()


def _chown_chu_tree_function(text: str) -> str:
    start = text.index("path_has_symlink_component() {")
    end = text.index("\n\nneeds_chown=false", start)
    return text[start:end]


def _run_helper(
    text: str,
    target: Path,
    log_path: Path,
    *,
    chu_home: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("sh not available")
    chu_home = target if chu_home is None else chu_home
    script = (
        "set -eu\n"
        f'CHU_HOME="{chu_home}"\n'
        f"{_chown_chu_tree_function(text)}\n"
        f'chown() {{ printf "%s\\n" "$*" >> "{log_path}"; }}\n'
        f'chown_chu_tree "{target}"\n'
    )
    return subprocess.run([shell, "-c", script], capture_output=True, text=True)


def test_chown_helper_repairs_real_directories(stage2_text: str, tmp_path: Path) -> None:
    target = tmp_path / "home"
    target.mkdir()
    log_path = tmp_path / "chown.log"

    proc = _run_helper(stage2_text, target, log_path)

    assert proc.returncode == 0, proc.stderr
    assert log_path.read_text().splitlines() == [
        f"-R chu:chu {target}",
    ]


def test_chown_helper_refuses_symlinked_directories(stage2_text: str, tmp_path: Path) -> None:
    real_home = tmp_path / "real-home"
    real_home.mkdir()
    symlinked_home = tmp_path / "chu-home"
    try:
        symlinked_home.symlink_to(real_home, target_is_directory=True)
    except (NotImplementedError, OSError):
        pytest.skip("directory symlinks are not available on this platform")
    log_path = tmp_path / "chown.log"

    proc = _run_helper(stage2_text, symlinked_home, log_path)

    assert proc.returncode == 0, proc.stderr
    assert not log_path.exists()
    assert "refusing recursive chown through symlinked path" in proc.stdout


def test_chown_helper_refuses_target_under_symlinked_home(
    stage2_text: str,
    tmp_path: Path,
) -> None:
    real_home = tmp_path / "real-home"
    (real_home / "cron").mkdir(parents=True)
    linked_home = tmp_path / "linked-home"
    try:
        linked_home.symlink_to(real_home, target_is_directory=True)
    except (NotImplementedError, OSError):
        pytest.skip("directory symlinks are not available on this platform")
    log_path = tmp_path / "chown.log"

    proc = _run_helper(
        stage2_text,
        linked_home / "cron",
        log_path,
        chu_home=linked_home,
    )

    assert proc.returncode == 0, proc.stderr
    assert not log_path.exists(), "must not chown through a symlinked CHU_HOME"
    assert "refusing recursive chown through symlinked path" in proc.stdout


def test_stage2_uses_symlink_safe_helper_for_chu_home_trees(stage2_text: str) -> None:
    assert 'chown_chu_tree "$CHU_HOME/$sub"' in stage2_text
    assert 'chown_chu_tree "$CHU_HOME/profiles"' in stage2_text
    assert 'chown_chu_tree "$CHU_HOME/cron"' in stage2_text
    assert 'chown -R chu:chu "$CHU_HOME/$sub"' not in stage2_text
    assert 'chown -R chu:chu "$CHU_HOME/profiles"' not in stage2_text
    assert 'chown -R chu:chu "$CHU_HOME/cron"' not in stage2_text


def test_stage2_skips_top_level_chown_for_symlinked_chu_home(
    stage2_text: str,
) -> None:
    assert 'refuse_symlinked_path "chown" "$CHU_HOME"' in stage2_text


def test_stage2_skips_recursive_repairs_when_tree_is_already_owned(
    stage2_text: str,
) -> None:
    assert "tree_has_non_chu_owner() {" in stage2_text
    assert 'if [ -e "$CHU_HOME/$sub" ] && tree_has_non_chu_owner "$CHU_HOME/$sub"; then' in stage2_text
    assert 'if [ -d "$CHU_HOME/profiles" ] && tree_has_non_chu_owner "$CHU_HOME/profiles"; then' in stage2_text
    # Sibling every-boot chown blocks carry the same warm-boot gate.
    assert 'if [ -d "$CHU_HOME/cron" ] && tree_has_non_chu_owner "$CHU_HOME/cron"; then' in stage2_text
    assert 'if [ -d "$CHU_HOME/platforms/pairing" ] && tree_has_non_chu_owner "$CHU_HOME/platforms/pairing"; then' in stage2_text
    assert 'if [ -d "$CHU_HOME/pairing" ] && tree_has_non_chu_owner "$CHU_HOME/pairing"; then' in stage2_text
