"""Resolve CHU_HOME for standalone skill scripts.

Skill scripts may run outside the Chu process (e.g. system Python,
nix env, CI) where ``chu_constants`` is not importable.  This module
provides the same ``get_chu_home()`` and ``display_chu_home()``
contracts as ``chu_constants`` without requiring it on ``sys.path``.

When ``chu_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``chu_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``CHU_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from chu_constants import display_chu_home as display_chu_home
    from chu_constants import get_chu_home as get_chu_home
except (ModuleNotFoundError, ImportError):

    def get_chu_home() -> Path:
        """Return the Chu home directory (default: ~/.chu).

        Mirrors ``chu_constants.get_chu_home()``."""
        val = os.environ.get("CHU_HOME", "").strip()
        return Path(val) if val else Path.home() / ".chu"

    def display_chu_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``chu_constants.display_chu_home()``."""
        home = get_chu_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
