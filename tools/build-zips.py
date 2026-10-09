#!/usr/bin/env python3
"""Fabrique les deux zips d'une release GitHub.

- polyglots-fr-pte-chrome.zip : un dossier polyglots-fr-pte/ contenant l'extension
  Chrome (manifest.json de la racine). Une fois dézippé, c'est ce dossier qu'on
  charge dans chrome://extensions.
- polyglots-fr-pte-firefox.zip : l'extension Firefox (fabriquée par
  tools/build-firefox.py) avec manifest.json à la racine du zip, à choisir
  directement dans about:debugging.

Exclus : tools/, dist/, README.md et les fichiers cachés. LICENSE est inclus.
Les archives sont reproductibles (dates, droits et ordre des entrées fixes).

Usage : python3 tools/build-zips.py [--out <dossier>]   (défaut : dist/)
"""

import argparse
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True  # pas de __pycache__ dans tools/

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

CHROME_ZIP = "polyglots-fr-pte-chrome.zip"
FIREFOX_ZIP = "polyglots-fr-pte-firefox.zip"
CHROME_FOLDER = "polyglots-fr-pte"
FIXED_DATE = (2026, 1, 1, 0, 0, 0)
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def load_firefox_builder():
    """Charge tools/build-firefox.py (nom avec tiret, donc pas importable directement)."""
    spec = importlib.util.spec_from_file_location("build_firefox", HERE / "build-firefox.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def zip_tree(source, archive, prefix=""):
    """Zippe `source` dans `archive`, sous `prefix`, de façon reproductible."""
    files = sorted(p for p in source.rglob("*") if p.is_file())
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files:
            name = (Path(prefix) / path.relative_to(source)).as_posix()
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3  # Unix, pour que les droits ci-dessous soient respectés
            info.external_attr = 0o644 << 16
            zf.writestr(info, path.read_bytes(), compresslevel=9)


def main():
    parser = argparse.ArgumentParser(description="Construit les zips Chrome et Firefox d'une release.")
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "dist",
        help="dossier de sortie des zips (défaut : dist/)",
    )
    args = parser.parse_args()
    out = args.out.expanduser().resolve()

    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")).get("version", "")
    if not SEMVER.match(str(version)):
        sys.exit(f"Version du manifeste invalide : « {version} » (attendu : x.y.z).")

    bf = load_firefox_builder()
    out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="pfr-zips-") as tmp:
        tmp = Path(tmp)

        chrome_dir = tmp / "chrome"
        shutil.copytree(ROOT, chrome_dir, ignore=bf.ignore)
        chrome_zip = out / CHROME_ZIP
        zip_tree(chrome_dir, chrome_zip, prefix=CHROME_FOLDER)

        firefox_dir = bf.build(tmp / "firefox", marker=False)  # pas de témoin dans le zip
        firefox_zip = out / FIREFOX_ZIP
        zip_tree(firefox_dir, firefox_zip)

    print(f"Version {version}")
    print(chrome_zip)
    print(firefox_zip)


if __name__ == "__main__":
    main()
