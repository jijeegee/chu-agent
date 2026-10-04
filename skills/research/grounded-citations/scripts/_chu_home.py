"""Resolve CHU_HOME for standalone skill scripts.

Skill scripts may run outside the Chu process (system Python, nix env,
CI) where ``chu_constants`` is not importable.  This module provides the
same ``get_chu_home()`` contract without requiring it on ``sys.path``.

When ``chu_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from chu_constants import get_chu_home as get_chu_home
except (ModuleNotFoundError, ImportError):

    def get_chu_home() -> Path:
        """Return the Chu home directory (default: ``~/.chu``)."""
        val = os.environ.get("CHU_HOME", "").strip()
        return Path(val) if val else Path.home() / ".chu"
