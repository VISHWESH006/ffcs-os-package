#!/bin/bash
set -e

echo "=== FFCS OS — Local Launcher ==="

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found. Install Python 3.9+"; exit 1
fi

# Check Node
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Install Node.js 18+"; exit 1
fi

# Install Python deps once
echo "[1/3] Checking Python dependencies..."
python3 -c "import ortools, pydantic" 2>/dev/null || \
  pip3 install ortools pydantic aiosqlite aiofiles openpyxl fpdf2

echo "[2/4] Checking Node dependencies..."
export VITE_API_BASE_URL="http://localhost:8080/api"

if [ ! -x "api-server/node_modules/.bin/esbuild" ]; then
  echo "ERROR: API dependencies are missing. Run 'npm ci' in api-server/ first."; exit 1
fi
echo "[3/4] Building API..."
cd api-server
npm run build
cd ..

if [ ! -x "frontend/node_modules/.bin/vite" ]; then
  echo "ERROR: Frontend dependencies are missing. Run 'npm ci' in frontend/ first."; exit 1
fi
echo "[4/5] Building frontend..."
cd frontend
npm run build
cd ..

# Start API server (background)
echo "[5/5] Starting API server on :8080..."
cd api-server
export PORT=8080
export CORS_ORIGINS="http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173"
node --enable-source-maps dist/index.mjs &
API_PID=$!
cd ..

sleep 1

# Start frontend
echo ""
echo "✅  FFCS OS is ready!"
echo "   Frontend → http://localhost:3000"
echo "   API      → http://localhost:8080/api"
echo ""
echo "Press Ctrl+C to stop."

node scripts/serve-frontend.mjs frontend/dist 3000 &
SERVE_PID=$!

trap "kill $API_PID $SERVE_PID 2>/dev/null; exit" INT TERM
wait
