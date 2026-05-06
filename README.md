# Tabr

AI-powered guitar tab generator using webcam computer vision + audio transcription.

See [`AGENTS.md`](./AGENTS.md) for the full product spec.

---

## Running the app locally

You need **two terminals**: one for the FastAPI backend, one for the Vite frontend.

### Prerequisites

- **Node.js 20+**
- **Python 3.11** (the backend venv is pinned to 3.11 because `basic-pitch` requires `tensorflow<2.15.1`, which has no wheels for 3.12+)
- **ffmpeg** binary on PATH — verify with `ffmpeg -version`
  - Windows: `winget install Gyan.FFmpeg` (restart shell after)
  - macOS: `brew install ffmpeg`

### First-time setup

```powershell
# Backend — create the Python 3.11 venv and install deps
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Frontend — install npm packages
cd ..\frontend
npm install
```

The MediaPipe hand-landmarker model file (`hand_landmarker.task`) is already in `frontend/public/`.

### Running (every time)

**Terminal 1 — backend** (from `backend/`):

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000
```

Or without activating the venv:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Backend serves at `http://localhost:8000`. Sanity check: `http://localhost:8000/health` should return `{"status":"ok"}`.

**Terminal 2 — frontend** (from `frontend/`):

```powershell
npm run dev
```

Frontend serves at `http://localhost:5173`. Open it in your browser, allow camera + mic access, and you're in.

### Testing the audio endpoint directly

```powershell
curl.exe -X POST http://localhost:8000/process -F "video=@sample.webm"
```

Should return `{ "notes": [...] }` for a recording ≥ 2 seconds with detectable notes.

---

## Project structure

```
tabr/
├── backend/      # FastAPI + basic-pitch audio transcription
│   └── .venv/    # Python 3.11 virtualenv (gitignored)
├── frontend/     # React + Vite + Tailwind + MediaPipe
│   └── public/   # hand_landmarker.task lives here
└── AGENTS.md     # Full product spec
```
