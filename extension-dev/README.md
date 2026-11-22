# FFCS OS Development Test Copy

This separate unpacked extension copy is configured for exactly these HTTPS origins:

- `https://vtop.vitbhopal.ac.in/*`
- `https://ffcs-demo.vercel.app/*`
- `https://dev.vitbhopal.ac.in/*`

Changes for this task are confined to this development copy; the shared extractor core, export schema, source URL sanitizer, merge, deduplication, and JSON export were left unchanged. The dev host is a test origin, so it is not accepted by the strict VTOP source URL sanitizer.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Temporarily turn off the production **FFCS OS Bulk Import** extension so you do not open the wrong copy.
4. Select **Load unpacked** and choose `C:\Users\HPVICTUS\Desktop\PROJECT\timetable\ffcs-os-package\extension-dev` (the folder containing this README and `manifest.json`).
5. Confirm the popup heading says **FFCS OS Development Test Copy**.
6. Open the VIT Bhopal registration page and refresh it after loading the extension. The popup should recognize the host and enable **Import This Page** when it finds a supported offering table.

## Split course and offering tables

The dev extractor recognizes a course details table and a separate offering table. If exactly one explicit course record is present, its code, title, credits, and L/T/P/J values are associated with the offering rows. If offering rows contain course codes, those rows are associated by their own code. When there are several course records but the offering rows contain no course identifier, extraction fails with an ambiguity reason instead of assigning offerings by guesswork. The offering table's “Slot Status (with Registered Course)” value is not treated as a class status. Empty seat values remain unknown; the string `0` remains zero.

## Verification

Run the extension regression suites from `ffcs-os-package`:

```powershell
node --test tests/extension-dev-config.test.js tests/extension-dev-extraction.test.js
```

The live VIT Bhopal Chrome check is available from `ffcs-os-package/frontend` with `node --test extension-e2e/dev-vtop-live.test.mjs`. The current environment could not reach the site, so fixture tests verify the described split-table structure but do not prove that the deployed page currently renders the same DOM or that the extension extracts its live rows. Refresh the page after loading the unpacked extension; if **Table Found** does not appear, capture the rendered table headers and row structure for further adaptation. The existing production extension test files refer to an `extension/` source directory that is absent from this checkout.
