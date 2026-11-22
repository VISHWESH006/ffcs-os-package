# FFCS OS production Chrome extension

This is the production-only Manifest V3 package source. It supports only `https://vtop.vitbhopal.ac.in/*`. The `extension-dev/` test copy remains separate and is not used by the production packager.

## Runtime workflow

The content script detects supported registration tables and extracts course/offering rows. The popup requests extraction from the active VTOP tab, merges and deduplicates rows in the existing extraction core, saves collection state in `chrome.storage.local`, and exports the established JSON schema by download or clipboard. Extraction mappings, validation, merging, deduplication, and export behavior are retained from `extension-dev/`.

The extension does not call the FFCS OS backend. Students import the exported JSON into the web planner, whose API base URL is configured at frontend build time with `VITE_API_BASE_URL` (see `frontend/README.md`). No deployed backend URL was present in this checkout, and the extension does not need one for its existing workflow; adding an unused endpoint or broadening permissions would not improve its operation.

## Build the ZIP

From the repository root:

```powershell
python scripts/package_extension.py --source extension --output dist/ffcs-os-extension.zip
```

The packager follows manifest and local script/style references, checks the production host allowlist, and places `manifest.json` at the ZIP root. It excludes this README and unreferenced files. It refuses development domains and does not fall back to `extension-dev/`.

To load unpacked for local verification, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the `extension/` directory. Confirm the VTOP popup reports a supported registration table before importing.
