# FFCS OS frontend

This is the React 18 + TypeScript + Vite student planner. Its API client reads the public build-time variable `VITE_API_BASE_URL`; do not put credentials or private backend values in any `VITE_*` variable.

## Vercel project settings

Configure the Vercel project as follows:

- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Install Command:** `npm ci`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Environment variable:** `VITE_API_BASE_URL=https://<your-render-service>.onrender.com/api` for Production, Preview, and Development as appropriate.

These values are also recorded in `vercel.json`. The API URL is public and is embedded into the generated JavaScript at build time. Deploy again after changing it.

## Local development

1. Start the backend from the repository root using `start.bat` on Windows or `./start.sh` on macOS/Linux; the API listens on port `8080`.
2. In this directory, run `npm ci` once, then `npm run dev`.
3. Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8080` when no `VITE_API_BASE_URL` is set.

## Checks

```sh
npm run typecheck
npm test
npm run build
```
