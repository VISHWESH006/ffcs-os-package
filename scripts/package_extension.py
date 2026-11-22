#!/usr/bin/env python3
"""Package the production MV3 extension without the development test copy."""
from __future__ import annotations

import argparse
import glob
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
VTOP_MATCH = "https://vtop.vitbhopal.ac.in/*"
FORBIDDEN_HOST_MARKERS = ("localhost", "127.0.0.1", "ffcs-demo.vercel.app", "dev.vitbhopal.ac.in", "<all_urls>")
HTML_REF = re.compile(r"(?:src|href)\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
CSS_REF = re.compile(r"url\(\s*[\"']?([^\"')]+)", re.IGNORECASE)
JS_REF = re.compile(
    r"(?:^\s*import\s+(?:[^'\";]*?\s+from\s+)?|(?:chrome\.)?runtime\.getURL\s*\(\s*)[\"']([^\"']+)[\"']",
    re.MULTILINE,
)


def _manifest_references(manifest: dict) -> list[str]:
    references: list[str] = []
    action = manifest.get("action", {})
    for key in ("default_popup",):
        if action.get(key):
            references.append(action[key])
    for section in (manifest.get("icons", {}), action.get("default_icon", {})):
        references.extend(value for value in section.values() if isinstance(value, str))
    background = manifest.get("background", {})
    if background.get("service_worker"):
        references.append(background["service_worker"])
    for key in ("options_page", "devtools_page"):
        if manifest.get(key):
            references.append(manifest[key])
    options_ui = manifest.get("options_ui", {})
    if options_ui.get("page"):
        references.append(options_ui["page"])
    side_panel = manifest.get("side_panel", {})
    if side_panel.get("default_path"):
        references.append(side_panel["default_path"])
    for page in manifest.get("chrome_url_overrides", {}).values():
        references.append(page)
    for content_script in manifest.get("content_scripts", []):
        references.extend(content_script.get("js", []))
        references.extend(content_script.get("css", []))
    for resource_set in manifest.get("web_accessible_resources", []):
        references.extend(resource_set.get("resources", []))
    return references


def _inside_source(source: Path, ref: str) -> list[Path]:
    if ref.startswith(("http://", "https://", "data:", "chrome://")):
        return []
    normalized = ref.split("?", 1)[0].split("#", 1)[0].replace("\\", "/")
    if not normalized or normalized.startswith("/") or ".." in PurePosixPath(normalized).parts:
        raise ValueError(f"Unsafe or empty extension asset path: {ref!r}")
    matches = [Path(name) for name in glob.glob(str(source / normalized), recursive=True)] if any(c in normalized for c in "*?[") else [source / normalized]
    if not matches or any(not item.is_file() for item in matches):
        raise ValueError(f"Manifest or local reference points to missing asset: {ref}")
    return matches


def _validate_production_manifest(manifest: dict) -> None:
    if manifest.get("manifest_version") != 3:
        raise ValueError("Production package must use Manifest V3")
    hosts = list(manifest.get("host_permissions", []))
    for item in manifest.get("content_scripts", []):
        hosts.extend(item.get("matches", []))
    if VTOP_MATCH not in hosts:
        raise ValueError(f"Production manifest must include {VTOP_MATCH}")
    for host in hosts:
        if any(marker in host.lower() for marker in FORBIDDEN_HOST_MARKERS):
            raise ValueError(f"Development or broad host is not allowed in production package: {host}")
        if host != VTOP_MATCH:
            raise ValueError(f"Unreviewed production host permission/match: {host}")


def package(source: Path, output: Path) -> list[str]:
    source = source.resolve()
    manifest_path = source / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError(
            f"Production extension source is missing at {source}. "
            "The extension-dev directory is deliberately never used as a fallback."
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _validate_production_manifest(manifest)

    selected: set[Path] = {manifest_path}
    pending = _manifest_references(manifest)
    while pending:
        ref = pending.pop()
        for file_path in _inside_source(source, ref):
            if file_path in selected:
                continue
            rel_parts = file_path.relative_to(source).parts
            if any(part.lower() in {"tests", "test", "docs", "node_modules", "__pycache__"} for part in rel_parts):
                raise ValueError(f"Production manifest references a test/documentation/dependency file: {ref}")
            if file_path.suffix.lower() == ".map" or file_path.name.lower().startswith("readme") or file_path.name.startswith("."):
                raise ValueError(f"Production manifest references a development-only file: {ref}")
            selected.add(file_path)
            text = file_path.read_text(encoding="utf-8", errors="ignore") if file_path.suffix.lower() in {".html", ".htm", ".css", ".js", ".mjs"} else ""
            if file_path.suffix.lower() in {".html", ".htm"}:
                pending.extend(HTML_REF.findall(text))
            elif file_path.suffix.lower() == ".css":
                pending.extend(CSS_REF.findall(text))
            elif file_path.suffix.lower() in {".js", ".mjs"}:
                pending.extend(JS_REF.findall(text))

    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(selected):
            archive.write(file_path, file_path.relative_to(source).as_posix())
    return sorted(file_path.relative_to(source).as_posix() for file_path in selected)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "extension")
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "ffcs-os-extension.zip")
    args = parser.parse_args()
    try:
        files = package(args.source, args.output)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Extension packaging stopped: {error}", file=sys.stderr)
        return 1
    print(f"Created {args.output} with {len(files)} files; manifest.json is at the ZIP root.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
