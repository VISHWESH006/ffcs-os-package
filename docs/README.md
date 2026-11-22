# FFCS OS Documentation

Welcome to the FFCS OS documentation. Start here:

| Doc | Contents |
|-----|---------|
| [Architecture](architecture.md) | System design, data flow, CP-SAT model |
| [API Reference](api.md) | All 14 REST endpoints with examples |
| [Browser Extension](../browser-extension/README.md) | How to build and install the scraper |

## Quick start

1. Install the browser extension (see `browser-extension/` directory — load as unpacked extension in Chrome Dev Mode)
2. Navigate to VTOP → Course Registration page
3. Click the FFCS OS extension icon → **Extract from VTOP** → **Copy JSON**
4. Open the FFCS OS web app → **Import** page → paste JSON → **Parse**
5. Go to **Preferences** page → configure your constraints → click **Save**
6. Back on **Import** → click **Execute Optimizer** → wait ~2–8 seconds
7. Browse your top-20 timetables on the **Results** page
8. Save favourites and compare them on the **Compare** page
