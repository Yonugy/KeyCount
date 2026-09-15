# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller build spec for the KeyCount agent (agent.py). Produces a
# single-file binary: `keycount-agent` on macOS, `keycount-agent.exe` on
# Windows. There's no packaged Linux download -- "run from source" stays
# the only path there (DownloadPage.tsx only has macOS/Windows tabs), so
# this spec is never invoked on Linux in CI. It *was* built and run
# against this same agent.py in this project's Linux dev sandbox while
# writing this spec, purely as a packaging sanity check (does PyInstaller's
# bootloader unpack and launch the script correctly at all) -- see the
# 2026-09-14 phase 4 section of this repo's README for what that did and
# didn't prove.
#
# Why explicit hiddenimports instead of a bare `pyinstaller --onefile
# agent.py`: pynput ships its own PyInstaller hook (hook-pynput.py, from
# pyinstaller-hooks-contrib) that decides which backend submodules
# (pynput.keyboard._darwin vs ._win32 vs ._xorg, etc.) to bundle by
# *importing* pynput during the build and inspecting which backend it
# picked at import time. That's normally fine on a real macOS or Windows
# build machine -- pynput imports cleanly there and picks the right
# backend on its own. But it makes the bundled backend only as reliable as
# that import succeeding in whatever environment happens to run the
# build, which isn't guaranteed (confirmed firsthand: it fails outright in
# this project's own Linux sandbox, which has no display for pynput's X11
# backend to connect to -- see agent.py's own macOS/Windows split for the
# same kind of "don't rely on it happening to work" reasoning applied to
# foreground-app detection). Listing the real backend's submodules here
# explicitly means the build doesn't depend on that hook's import
# succeeding at all.
import sys

hidden_imports = []
if sys.platform == "darwin":
    hidden_imports = [
        "pynput._util.darwin",
        "pynput._util.darwin_vks",
        "pynput.keyboard._darwin",
        "pynput.mouse._darwin",
    ]
elif sys.platform == "win32":
    hidden_imports = [
        "pynput._util.win32",
        "pynput._util.win32_vks",
        "pynput.keyboard._win32",
        "pynput.mouse._win32",
    ]

a = Analysis(
    ["agent.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="keycount-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
