from pathlib import Path


def test_windows_native_install_path_docs_match_installer() -> None:
    doc = Path("website/docs/user-guide/windows-native.md").read_text()
    install = Path("scripts/install.ps1").read_text()

    # The launchers live in the managed binary dir OUTSIDE the git checkout
    # (CHU_HOME\bin, next to the managed uv) — NOT the whole venv\Scripts
    # (which would shadow the user's python, #83797) and NOT a dir inside
    # the checkout (which `chu update`'s autostash swept off disk).
    assert "%LOCALAPPDATA%\\chu\\bin" in doc
    assert (
        "Get-Command chu        # should print "
        "C:\\Users\\<you>\\AppData\\Local\\chu\\bin\\chu.exe"
    ) in doc
    # Installer exposes $ChuHome\bin, and must copy the launchers into it.
    assert '$chuBin = "$ChuHome\\bin"' in install
    assert "chu.exe" in install and "chu-acp.exe" in install
    # Guard against regressions to either legacy layout.
    assert '$chuBin = "$InstallDir\\venv\\Scripts"' not in install
    assert '$chuBin = "$InstallDir\\bin"' not in install
