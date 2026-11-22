# Sanitized VTOP Fixture Request for Phase 1.9

No real VTOP HTML/DOM capture is present in the repository. The automated Chrome test uses synthetic tables intercepted locally at the VTOP hostname; it does not establish production DOM compatibility. A representative sanitized capture is needed before making that claim.

## What to capture

For each supported Course Registration page layout, provide:

1. A saved HTML file of the registration page after the relevant table is visible. Preserve the original table tags, header rows, `<thead>`/`<tbody>`, nested cell elements, `rowspan`/`colspan`, and any repeated header rows. Keep only surrounding markup needed to understand table discovery.
2. A small expected-record JSON file listing each visible course and offering with course code, course name, component label, structure, credits, raw slot, faculty, venue, available/total seats, class status, and native offering identifier when present.
3. A short note describing which page/view produced it, whether the table loaded asynchronously, whether there were multiple tables, and whether the source is paginated or split across views. State “unknown” if pagination behavior is not established.

Include examples that actually occur in the captured page for header aliases, optional missing columns, multiple offerings, combined or unknown slots, zero and blank/unavailable seat values, multiple components, duplicates, and conflicting/divergent offerings. Do not add artificial rows just to cover cases; use separate synthetic tests for cases absent from the evidence.

For dynamic rendering, provide two sanitized states from the same page when feasible: before the registration table is inserted and after it appears. Include any table replacement behavior only if it was observed.

## Privacy steps

- Capture only a page you are authorized to inspect. Do not send passwords, cookies, local/session storage, request headers, authentication tokens, `jsessionid` values, or unredacted URLs.
- Before sharing, remove names and identifiers belonging to students, registration numbers, emails, phone numbers, grades, and unrelated personal content. Replace faculty names and course data too if they are considered private in the capture; maintain stable dummy values so expected rows still match.
- Preserve structural HTML and header text while replacing private cell values. Remove scripts, hidden form values, inline state blobs, and unrelated page content that might contain session or account data.
- Inspect the saved HTML locally as text and search for `jsessionid`, `session`, `token`, `cookie`, email-like values, student IDs, and names before sharing. Do not rely only on screenshot blur or browser redaction.
- Keep expected output separate from the HTML so the fixture can be reviewed and compared without executing page scripts.

Suggested fixture layout:

```text
tests/fixtures/vtop/
  layout-a-registration-sanitized.html
  layout-a-registration-expected.json
  layout-a-capture-notes.md
  layout-a-before-async-table-sanitized.html
  layout-a-after-async-table-sanitized.html
```

If the repository receives these captures, regression tests should run the existing content script against the preserved DOM and compare normalized rows and extraction metrics to the expected JSON. The current Phase 1.9 report does not claim this comparison was run.
