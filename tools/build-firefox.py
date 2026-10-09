#!/usr/bin/env python3
"""Fabrique la version Firefox de l'extension.

Le manifest.json de la racine est la version Chrome (service_worker). Ce script
en tire un manifeste Firefox (background.scripts + browser_specific_settings)
et copie les fichiers de l'extension dans dist/firefox/ (ou le dossier donné
par --out). Le dossier produit porte un fichier témoin (.polyglots-fr-pte-build) :
un dossier existant n'est vidé que s'il est vide ou porte ce témoin.

Usage : python3 tools/build-firefox.py [--out <dossier>]
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
DEFAULT_OUT = DIST / "firefox"

# Fichier témoin déposé dans le dossier produit : sans lui, un dossier non vide n'est jamais vidé.
MARKER = ".polyglots-fr-pte-build"

# Exclus de la copie : dossiers de travail (outils, sortie, tests), README et fichiers cachés.
# Ce filtre sert aussi au zip Chrome (build-zips.py).
EXCLUDED_NAMES = {"tools", "dist", "tests", "README.md"}

GECKO = {
    "id": "polyglots-fr-pte@reuhno.github.io",
    "strict_min_version": "121.0",
    "data_collection_permissions": {"required": ["none"]},
}


def ignore(directory, names):
    """Filtre de copytree : ignore fichiers cachés et éléments exclus (racine seulement)."""
    skipped = {n for n in names if n.startswith(".")}
    if Path(directory).resolve() == ROOT:
        skipped |= {n for n in names if n in EXCLUDED_NAMES}
    return skipped


def check_out(out):
    """Refuse (code de sortie 1) tout dossier de sortie qu'il serait dangereux de vider."""
    if out == ROOT or ROOT.is_relative_to(out):
        sys.exit("Dossier de sortie refusé : il contient ou est le dossier source.")
    if out.is_relative_to(ROOT) and (out == DIST or not out.is_relative_to(DIST)):
        sys.exit(
            f"Dossier de sortie refusé : {out} est dans le projet, hors d'un sous-dossier de dist/."
        )
    if out.exists():
        if not out.is_dir():
            sys.exit(f"Dossier de sortie refusé : {out} existe et n'est pas un dossier.")
        # Un dossier non vide n'est vidé que s'il a été produit par ce script (témoin présent).
        # Exception : dist/firefox, dossier de sortie par défaut, produit avant l'ajout du témoin.
        if any(out.iterdir()) and not (out / MARKER).is_file() and out != DEFAULT_OUT:
            sys.exit(
                f"Dossier de sortie refusé : {out} n'est pas vide et ne porte pas le témoin "
                f"{MARKER} (il n'a pas été produit par ce script). Choisis un dossier neuf ou vide."
            )


def build(out, marker=True):
    """Écrit la version Firefox dans le dossier `out` et le renvoie.

    Un dossier existant n'est vidé que s'il est vide ou porte le témoin MARKER (voir check_out).
    Le témoin est déposé dans le dossier produit, sauf `marker=False` (dossier temporaire
    dont le contenu part dans une archive : build-zips.py).
    """
    out = Path(out).expanduser().resolve()
    check_out(out)

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    background = manifest.get("background", {})
    manifest["background"] = {
        "scripts": [background.get("service_worker", "background.js")],
        "type": background.get("type", "module"),
    }
    manifest["browser_specific_settings"] = {"gecko": GECKO}

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT, out, ignore=ignore)
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if marker:
        (out / MARKER).write_text(
            "Dossier produit par tools/build-firefox.py : il peut être vidé et reconstruit.\n",
            encoding="utf-8",
        )
    return out


def main():
    parser = argparse.ArgumentParser(description="Construit la version Firefox de l'extension.")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=(
            "dossier de sortie (défaut : dist/firefox). Vidé avant, mais seulement s'il est vide "
            "ou produit par ce script (témoin " + MARKER + ") ; dans le projet, seul dist/ est admis."
        ),
    )
    args = parser.parse_args()
    print(build(args.out))


if __name__ == "__main__":
    main()
