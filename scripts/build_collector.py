import os
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
out = root / "collector-dist"
if out.exists(): shutil.rmtree(out)
name = "collector.exe" if os.name == "nt" else "collector"
subprocess.check_call([sys.executable, "-m", "PyInstaller", "--onefile", "--clean", "--name", pathlib.Path(name).stem, "--distpath", str(out), "--workpath", str(root / "build" / "pyinstaller"), "--specpath", str(root / "build"), str(root / "collector" / "collector.py")])
print(out / name)
