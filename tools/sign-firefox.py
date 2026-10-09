#!/usr/bin/env python3
"""Signe la version Firefox hors AMO (canal « non listé ») et prépare les mises à jour automatiques.

Un .xpi signé s'installe de façon permanente dans Firefox (un clic ou un glisser-déposer), sans publication sur
addons.mozilla.org. Firefox le met ensuite à jour tout seul : le manifeste porte une `update_url`
(tools/build-firefox.py, GECKO) qui pointe vers le fichier `updates.json` de la dernière release GitHub.

Marche à suivre pour publier une version (Renaud, dans son terminal) :
  1. Monter `version` dans manifest.json (x.y.z) et COMMITER : AMO refuse une version déjà envoyée, et le script refuse
     de signer un dépôt qui a des modifications non commitées (`git status --porcelain`), sauf avec --allow-dirty.
  2. Fabriquer les zips :   python3 tools/build-zips.py --out <dossier>
  3. Obtenir ses clés AMO (https://addons.mozilla.org/developers/addon/api/key/ : « JWT issuer » et « JWT secret »)
     et les mettre dans l'ENVIRONNEMENT, jamais en argument de ligne de commande ni dans un fichier du dépôt :
       export AMO_JWT_ISSUER='user:…'
       export AMO_JWT_SECRET='…'
  4. Signer :               python3 tools/sign-firefox.py --out <dossier>
     Produit <dossier>/polyglots-fr-pte-<version>.xpi (signé par Mozilla) et <dossier>/updates.json.
     La signature est faite par un envoi à AMO : elle demande du réseau et peut prendre quelques minutes.
  5. Publier avec le TAG `v<version>` (le « v » est obligatoire : updates.json désigne le .xpi par
     releases/download/v<version>/…) et les QUATRE fichiers, sous ces noms exacts :
       gh release create v<version> <dossier>/polyglots-fr-pte-chrome.zip <dossier>/polyglots-fr-pte-firefox.zip
         <dossier>/polyglots-fr-pte-<version>.xpi <dossier>/updates.json
     Le nom `updates.json` est figé : c'est celui de l'`update_url` du manifeste Firefox
     (releases/latest/download/updates.json), qui désigne toujours la dernière release hors pré-version. Passer la
     release en « latest » déclenche donc les mises à jour de Firefox.

Options :
  --out <dossier>        dossier de sortie (défaut : dist/).
  --allow-dirty          signer malgré des modifications non commitées (à éviter : le .xpi ne correspondrait plus à un commit).
  --updates-only <xpi>   régénère seulement updates.json à partir d'un .xpi existant, sans signer ni se connecter
                         (essais, dépannage). Le fichier doit être une archive zip lisible, signée (META-INF/), dont le
                         manifeste porte la version du dépôt ; sinon refus. Les clés AMO ne sont pas nécessaires.

Sécurité des clés :
  - elles ne sont lues que dans AMO_JWT_ISSUER et AMO_JWT_SECRET ; elles ne sont jamais affichées, écrites ni passées en
    argument (visible par `ps`) ;
  - web-ext et ses dépendances sont installés par `npm ci --ignore-scripts` à partir de tools/web-ext/package-lock.json :
    arbre de dépendances VERROUILLÉ (versions et empreintes), scripts d'installation désactivés. Cette installation
    s'exécute avec un environnement SANS les clés (AMO_* et WEB_EXT_API_* retirés) ;
  - les clés ne sont transmises qu'au processus de signature (`node …/web-ext.js sign`), par son environnement
    (WEB_EXT_API_KEY et WEB_EXT_API_SECRET, lues par web-ext comme ses options --api-key et --api-secret) ;
  - si web-ext échoue (validation, délai), son code de sortie est affiché et rien n'est écrit dans le dossier de sortie.

Mettre à jour web-ext : changer la version dans tools/web-ext/package.json, puis, dans ce dossier,
`npm install --package-lock-only --ignore-scripts` et commiter les deux fichiers (version publiée depuis plus de deux semaines).

Prérequis : Node.js 20 ou plus (node et npm) et un accès au réseau.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True  # pas de __pycache__ dans tools/

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TOOL_DIR = HERE / "web-ext"  # package.json + package-lock.json de web-ext (exclu des zips avec tools/)

RELEASE_DOWNLOAD_BASE = "https://github.com/reuhno/polyglots-fr-pte/releases/download"
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
ENV_ISSUER = "AMO_JWT_ISSUER"
ENV_SECRET = "AMO_JWT_SECRET"
SECRET_ENV_PREFIXES = ("AMO_", "WEB_EXT_API_")  # retirées de l'environnement de tout sous-processus qui n'en a pas besoin
MIN_NODE_MAJOR = 20


def load_firefox_builder():
    """Charge tools/build-firefox.py (nom avec tiret, donc pas importable directement)."""
    spec = importlib.util.spec_from_file_location("build_firefox", HERE / "build-firefox.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_version():
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")).get("version", "")
    if not SEMVER.match(str(version)):
        sys.exit(f"Version du manifeste invalide : « {version} » (attendu : x.y.z).")
    return version


def pinned_web_ext_version():
    """Version exacte de web-ext, lue dans tools/web-ext/package.json (source unique)."""
    try:
        version = json.loads((TOOL_DIR / "package.json").read_text(encoding="utf-8"))["dependencies"]["web-ext"]
    except (OSError, ValueError, KeyError):
        sys.exit(f"{TOOL_DIR / 'package.json'} est absent ou illisible (dépendance web-ext attendue).")
    if not SEMVER.match(str(version)):
        sys.exit(f"web-ext doit être épinglé en version exacte x.y.z dans tools/web-ext/package.json (trouvé : « {version} »).")
    return version


def xpi_name(version):
    return f"polyglots-fr-pte-{version}.xpi"


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_xpi(xpi, version):
    """Contrôle un .xpi signé. Retourne None s'il est valide, sinon (code, message).

    Codes : « unreadable » (pas une archive zip lisible, ou sans manifeste lisible), « version » (autre version que le
    dépôt), « unsigned » (pas de signature : META-INF/ absent).
    """
    try:
        with zipfile.ZipFile(xpi) as zf:
            names = zf.namelist()
            if "manifest.json" not in names:
                return ("unreadable", "pas de manifest.json dans l'archive")
            declared = json.loads(zf.read("manifest.json").decode("utf-8")).get("version")
    except (zipfile.BadZipFile, ValueError, OSError) as e:
        return ("unreadable", f"archive zip illisible ({e.__class__.__name__})")
    if declared != version:
        return ("version", f"il déclare la version {declared}, le manifeste du dépôt {version}")
    if not any(n.startswith("META-INF/") for n in names):
        return ("unsigned", "il n'est pas signé (META-INF/ absent)")
    return None


def updates_manifest(gecko_id, version, xpi):
    """Manifeste de mise à jour (Extension Workshop, « Updating your extension »), une seule entrée : la version courante."""
    return {
        "addons": {
            gecko_id: {
                "updates": [
                    {
                        "version": version,
                        # Le tag de la release doit être « v<version> » : le lien en dépend.
                        "update_link": f"{RELEASE_DOWNLOAD_BASE}/v{version}/{xpi_name(version)}",
                        "update_hash": f"sha256:{sha256_of(xpi)}",
                    }
                ]
            }
        }
    }


def write_updates(out, gecko_id, version, xpi):
    path = out / "updates.json"
    data = updates_manifest(gecko_id, version, xpi)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def clean_env():
    """Environnement sans les clés AMO ni les variables WEB_EXT_API_* (installation des dépendances)."""
    return {k: v for k, v in os.environ.items() if not k.startswith(SECRET_ENV_PREFIXES)}


def check_node():
    """Retourne (node, npm) ; arrêt si Node est absent ou plus ancien que MIN_NODE_MAJOR."""
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        sys.exit(f"node et npm sont introuvables : installer Node.js (version {MIN_NODE_MAJOR} ou plus).")
    out = subprocess.run([node, "--version"], capture_output=True, text=True, env=clean_env())
    m = re.match(r"v(\d+)\.", out.stdout.strip())
    if out.returncode != 0 or not m:
        sys.exit("`node --version` n'a pas donné de version lisible.")
    if int(m.group(1)) < MIN_NODE_MAJOR:
        sys.exit(f"Node.js {out.stdout.strip()} est trop ancien : la version {MIN_NODE_MAJOR} ou plus est requise (web-ext).")
    return node, npm


def check_clean_tree(allow_dirty):
    """Refuse de signer un dépôt qui a des modifications non commitées (sauf --allow-dirty). Sans git : avertissement."""
    try:
        res = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, env=clean_env())
    except FileNotFoundError:
        print("Avertissement : git est introuvable, l'état du dépôt n'est pas vérifié.", file=sys.stderr)
        return
    if res.returncode != 0:
        print("Avertissement : `git status` a échoué (dépôt git absent ?), l'état du dépôt n'est pas vérifié.", file=sys.stderr)
        return
    if res.stdout.strip() and not allow_dirty:
        sys.exit(
            "Le dépôt a des modifications non commitées : commite d'abord (le .xpi signé doit correspondre à un commit), "
            "ou relance avec --allow-dirty.\n" + res.stdout.rstrip()
        )


def install_web_ext(npm, tmp, web_ext_version):
    """Installe web-ext depuis le lockfile (npm ci, scripts désactivés, SANS les clés). Retourne le chemin de web-ext.js."""
    lock = TOOL_DIR / "package-lock.json"
    if not lock.is_file():
        sys.exit(f"{lock} est absent : sans lui l'arbre de dépendances n'est pas verrouillé.")
    tool = tmp / "tool"
    tool.mkdir()
    shutil.copyfile(TOOL_DIR / "package.json", tool / "package.json")
    shutil.copyfile(lock, tool / "package-lock.json")
    print(f"Installation verrouillée de web-ext {web_ext_version} (npm ci, scripts d'installation désactivés)…")
    result = subprocess.run(
        [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=tool, env=clean_env()
    )
    if result.returncode != 0:
        sys.exit(f"`npm ci` a échoué (code de sortie {result.returncode}) : rien n'a été signé.")
    pkg_json = tool / "node_modules" / "web-ext" / "package.json"
    try:
        pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit(f"{pkg_json} est introuvable après `npm ci` : rien n'a été signé.")
    if pkg.get("version") != web_ext_version:
        sys.exit(f"web-ext {pkg.get('version')} installé, {web_ext_version} attendu : rien n'a été signé.")
    bin_field = pkg.get("bin")
    rel = bin_field.get("web-ext") if isinstance(bin_field, dict) else bin_field
    script = (pkg_json.parent / (rel or "bin/web-ext.js")).resolve()
    if not script.is_file():
        sys.exit(f"{script} est introuvable après `npm ci` : rien n'a été signé.")
    return script


def main():
    parser = argparse.ArgumentParser(description="Signe la version Firefox (AMO, canal non listé) et écrit updates.json.")
    parser.add_argument("--out", type=Path, default=ROOT / "dist", help="dossier de sortie (défaut : dist/)")
    parser.add_argument("--updates-only", type=Path, metavar="XPI",
                        help="régénère seulement updates.json à partir de ce .xpi signé, sans signer")
    parser.add_argument("--allow-dirty", action="store_true",
                        help="signer même si le dépôt a des modifications non commitées")
    args = parser.parse_args()
    out = args.out.expanduser().resolve()

    version = read_version()
    bf = load_firefox_builder()
    gecko_id = bf.GECKO["id"]

    if args.updates_only:
        xpi = args.updates_only.expanduser().resolve()
        if not xpi.is_file():
            sys.exit(f"Fichier introuvable : {xpi}")
        problem = validate_xpi(xpi, version)
        if problem:
            sys.exit(f"{xpi.name} refusé : {problem[1]}.")
        out.mkdir(parents=True, exist_ok=True)
        print(f"Version {version}")
        print(write_updates(out, gecko_id, version, xpi))
        if xpi.name != xpi_name(version):
            print(f"Attention : joindre le .xpi à la release sous le nom {xpi_name(version)} (celui d'updates.json).", file=sys.stderr)
        return

    # Clés AMO : environnement uniquement, vérifiées avant tout travail. Leurs valeurs ne sont jamais affichées.
    issuer = os.environ.get(ENV_ISSUER, "").strip()
    secret = os.environ.get(ENV_SECRET, "").strip()
    missing = [name for name, value in ((ENV_ISSUER, issuer), (ENV_SECRET, secret)) if not value]
    if missing:
        sys.exit(
            f"Variable(s) d'environnement manquante(s) : {', '.join(missing)}. "
            "Les clés AMO (JWT issuer et JWT secret) se passent par l'environnement, jamais en argument."
        )
    web_ext_version = pinned_web_ext_version()
    node, npm = check_node()
    check_clean_tree(args.allow_dirty)

    with tempfile.TemporaryDirectory(prefix="pfr-sign-") as tmp:
        tmp = Path(tmp)
        # 1. Installation verrouillée, sans les clés dans l'environnement.
        web_ext_js = install_web_ext(npm, tmp, web_ext_version)

        # 2. Signature : les clés ne vont qu'à ce processus, par son environnement (jamais par sa ligne de commande).
        source = bf.build(tmp / "src", marker=False)  # pas de témoin dans l'archive signée
        artifacts = tmp / "artifacts"
        artifacts.mkdir()
        env = clean_env()
        env["WEB_EXT_API_KEY"] = issuer
        env["WEB_EXT_API_SECRET"] = secret
        cmd = [
            node, str(web_ext_js), "sign",
            "--channel", "unlisted",
            "--source-dir", str(source),
            "--artifacts-dir", str(artifacts),
        ]
        print(f"Signature de la version {version} par AMO (canal non listé), web-ext {web_ext_version}…")
        # cwd = dossier temporaire : web-ext n'écrit rien dans le dépôt.
        result = subprocess.run(cmd, cwd=tmp, env=env)
        if result.returncode != 0:
            sys.exit(f"web-ext a échoué (code de sortie {result.returncode}) : rien n'a été écrit dans {out}.")

        xpis = sorted(artifacts.glob("*.xpi"))
        if len(xpis) != 1:
            sys.exit(f"Un seul .xpi signé était attendu dans les artefacts, {len(xpis)} trouvé(s) : rien n'a été écrit dans {out}.")
        problem = validate_xpi(xpis[0], version)
        if problem:
            if problem[0] == "unreadable":
                sys.exit(f".xpi signé illisible ou sans manifeste ({problem[1]}) : rien n'a été écrit dans {out}.")
            sys.exit(f"Le .xpi signé est refusé : {problem[1]}. Rien n'a été écrit dans {out}.")

        out.mkdir(parents=True, exist_ok=True)
        xpi = out / xpi_name(version)
        shutil.copyfile(xpis[0], xpi)
        updates = write_updates(out, gecko_id, version, xpi)

    print(f"Version {version}")
    print(xpi)
    print(updates)


if __name__ == "__main__":
    main()
