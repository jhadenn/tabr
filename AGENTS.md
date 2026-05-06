# Tabr — Product Requirements Document
> AI-powered guitar tab generator using webcam computer vision + audio transcription

---

## 1. Product Overview

**Tabr** is a web application that lets a guitarist record themselves playing, then automatically generates editable guitar tabs from the footage using a dual-signal pipeline: computer vision (fret/string position detection via webcam) and audio transcription (pitch + timing via Basic Pitch). The user can edit the generated tab and export it as a PDF or copy it as plain text.

**Target user:** Solo guitarists who want a fast way to transcribe what they just played without manually figuring out tabs.

**Non-goals:**
- No user accounts or cloud storage
- No saving of recorded video or audio after processing
- No chord detection (single-note solo lines only in v1)
- No real-time tab generation during recording (process on submit)
- No mobile support in v1

---

## 2. User Flow

```
Fretboard Calibration (first time or on reset)
        ↓
[Start Recording] → webcam + mic live feed (no save)
        ↓
[Stop & Submit] → video blob sent to backend
        ↓
Processing screen (CV + audio pipeline runs)
        ↓
Tab Editor — generated tab displayed, fully editable
        ↓
[Export] → Download as PDF  |  Copy as plain text
```

---

## 3. Tech Stack

### Frontend
| Layer | Choice | Reason |
|---|---|---|
| Framework | **React 18 + Vite** | Fast DX, good MediaPipe JS ecosystem |
| Styling | **Tailwind CSS v3** | Utility-first, fast iteration |
| Webcam | **MediaRecorder API** (native) | Captures video + audio in one stream |
| CV (client-side) | **@mediapipe/tasks-vision** | Hand landmark detection, runs in browser via WASM, no backend needed for CV |
| Tab Editor | Custom React component | Editable ASCII-style 6-string grid |
| PDF Export | **jsPDF** | Client-side, no server needed |
| HTTP Client | **axios** | Backend communication |

### Backend
| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Python 3.11** | Basic Pitch requires Python |
| Framework | **FastAPI** | Async, fast, great for file uploads |
| Audio Transcription | **basic-pitch (Spotify)** | Best open-source audio-to-MIDI, handles polyphony |
| Audio Processing | **librosa**, **soundfile** | Extract audio from video, resample |
| Video Processing | **OpenCV (cv2)** | Extract frames from uploaded video blob |
| Tab Logic | Custom Python module | Sync CV + audio events, fret mapping |
| CORS | **fastapi.middleware.cors** | Allow React dev server |

### No database. Fully stateless — video is processed and discarded.

---

## 4. Repository Structure

```
tabr/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Calibration.jsx       # Fretboard bounding box setup
│   │   │   ├── Recorder.jsx          # Webcam + mic recording UI
│   │   │   ├── Processing.jsx        # Loading/progress screen
│   │   │   ├── TabEditor.jsx         # Tab display + inline editing
│   │   │   └── ExportBar.jsx         # PDF download + copy text buttons
│   │   ├── hooks/
│   │   │   ├── useMediaPipe.js       # MediaPipe hand tracking hook
│   │   │   ├── useRecorder.js        # MediaRecorder hook
│   │   │   └── useTabEditor.js       # Tab state management
│   │   ├── utils/
│   │   │   ├── fretMapper.js         # Map landmarks → fret/string using calibration
│   │   │   ├── tabFormatter.js       # Convert note events → ASCII tab string
│   │   │   └── pdfExport.js          # jsPDF tab rendering
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── main.py                       # FastAPI app + routes
│   ├── audio_processor.py            # Extract audio, run Basic Pitch
│   ├── video_processor.py            # Extract frames, run CV landmark extraction (optional server-side fallback)
│   ├── tab_generator.py              # Sync audio + CV data → tab note events
│   ├── fret_mapper.py                # Map fingertip coords → fret/string
│   └── requirements.txt
│
└── README.md
```

---

## 5. Feature Specifications

### 5.1 Fretboard Calibration

**Trigger:** First visit, or user clicks "Recalibrate" button.

**Flow:**
1. Webcam feed shown fullscreen
2. User drags a bounding box rectangle over the fretboard (nut to body, all 6 strings)
3. App stores: `{ x, y, width, height, nutX, bridgeX }` in `localStorage` under key `tabr_calibration`
4. A homography transform matrix is computed to normalize the fretboard region into a flat top-down grid
5. The grid is divided into: 6 rows (strings, low E to high e top to bottom) × 24 columns (frets)

**Implementation note:** Use a simple canvas overlay with draggable corner handles. Perspective correction via a 2D affine transform (strings are roughly parallel so full homography is optional — a simple rect crop + grid division works for v1).

### 5.2 Recording

**Component:** `Recorder.jsx`

**Behavior:**
- On mount: request `navigator.mediaDevices.getUserMedia({ video: true, audio: true })`
- Show live webcam feed via `<video>` element (muted, mirrored)
- Overlay real-time MediaPipe hand landmarks on a `<canvas>` element positioned on top of the video
- **During recording:** collect an array of landmark snapshots: `[{ timestamp_ms, landmarks: [...21 points] }]` in memory — do NOT send to backend yet
- MediaRecorder captures the stream into a `Blob` (format: `video/webm`)
- UI states: `idle → recording → stopped`

**Controls:**
- `[Start Recording]` button — begins MediaRecorder + landmark collection
- `[Stop & Submit]` button — stops recording, triggers processing screen, POSTs to backend

**Data sent to backend (`POST /process`):**
```json
{
  "video": <binary blob, multipart>,
  "landmarks": [
    { "timestamp_ms": 0, "fingertips": [{ "x": 0.45, "y": 0.33 }, ...] },
    ...
  ],
  "calibration": { "x": 120, "y": 80, "width": 480, "height": 160 }
}
```
Only fingertip landmarks are needed (indices 4, 8, 12, 16, 20 from MediaPipe's 21-point hand model).

### 5.3 MediaPipe Hand Tracking

**Library:** `@mediapipe/tasks-vision` (HandLandmarker)

**Config:**
```js
HandLandmarker.create({
  baseOptions: {
    modelAssetPath: "hand_landmarker.task", // hosted in /public
    delegate: "GPU"
  },
  runningMode: "VIDEO",
  numHands: 1,          // fretting hand only
  minHandDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5
})
```

**Frame rate:** Run detection every 2 frames (~15fps) to reduce compute load during recording.

**Fingertip indices used:** 4 (thumb), 8 (index), 12 (middle), 16 (ring), 20 (pinky)

### 5.4 Backend Processing Pipeline

**Endpoint:** `POST /process`
- Accepts: `multipart/form-data` with `video` file + `landmarks` JSON + `calibration` JSON
- Returns: `{ notes: [...], tab_string: "..." }`

**Steps inside `tab_generator.py`:**

1. **Extract audio** (`audio_processor.py`)
   - Use `librosa` or `ffmpeg-python` to extract audio track from video blob
   - Resample to 22050 Hz mono (Basic Pitch requirement)

2. **Run Basic Pitch** (`audio_processor.py`)
   - `from basic_pitch.inference import predict`
   - Returns: list of note events: `{ start_time_s, end_time_s, pitch_midi, confidence }`
   - Filter by `confidence > 0.7`

3. **Map CV landmarks to fret/string** (`fret_mapper.py`)
   - For each note event, find the landmark snapshot closest in timestamp
   - Apply calibration rect to normalize fingertip `(x, y)` into fretboard grid space
   - Determine which fingertip is lowest on the neck (most likely the fretting finger)
   - Map normalized position → `(string_index 0–5, fret_number 0–24)`
   - Cross-validate: confirm that the pitch at the detected fret matches Basic Pitch output (use standard guitar tuning `[E2, A2, D3, G3, B3, E4]` + fret offset formula: `midi_note = open_string_midi + fret_number`)
   - If CV fret is within ±2 semitones of audio pitch → accept CV position
   - If mismatch → fall back to audio pitch only, pick lowest viable fret position

4. **Build tab note events** (`tab_generator.py`)
   - Output: `[{ time_s, string: 0–5, fret: 0–24 }, ...]`

5. **Format as ASCII tab** (`tab_generator.py`)
   - Quantize note times to a grid (default: 16th note resolution at detected BPM)
   - Render standard 6-line ASCII tab format:
   ```
   e |---5---7---5---|
   B |---------------|
   G |---------------|
   D |---------------|
   A |---------------|
   E |---------------|
   ```

### 5.5 Tab Editor

**Component:** `TabEditor.jsx`

**Display:** Render the tab as a visual 6×N grid of cells. Each cell is either a fret number or a `-` dash.

**Editing:**
- Click any fret number cell → inline input field appears, accepts 0–24
- Press Enter or click away → commit edit, update tab state
- Add/remove measures (columns) via toolbar buttons
- Undo/redo via `Ctrl+Z` / `Ctrl+Y` (keep a history stack in `useTabEditor` hook)

**State shape:**
```js
{
  strings: 6,
  measures: [
    [
      // each measure: array of beats, each beat: array of 6 string values (null or fret int)
      [null, null, null, null, null, 5],   // beat 1: fret 5 on high e string
      [null, null, null, null, null, 7],
      ...
    ]
  ]
}
```

### 5.6 Export

**Option A — Copy as Text:**
- Button copies the ASCII tab string to clipboard via `navigator.clipboard.writeText()`
- Show brief "Copied!" toast confirmation

**Option B — Download as PDF:**
- Use `jsPDF` to render the 6-line tab with a monospace font
- Include title field ("Tabr — [user can type a name]") at top
- Download as `tabr-tab.pdf`
- Font: Courier (guaranteed monospace in jsPDF)

**Recommendation:** Include both. They serve different use cases (copy for sharing online, PDF for printing/saving).

---

## 6. API Contract

### `POST /process`
**Request:** `multipart/form-data`
- `video`: binary (video/webm)
- `landmarks`: JSON string → `Array<{ timestamp_ms: number, fingertips: Array<{x,y}> }>`
- `calibration`: JSON string → `{ x, y, width, height }`

**Response:** `application/json`
```json
{
  "notes": [
    { "time_s": 0.24, "string": 5, "fret": 5 },
    { "time_s": 0.56, "string": 5, "fret": 7 }
  ],
  "tab_string": "e |---5---7---5---|\nB |---------------|\n..."
}
```

**Error responses:**
- `400` — no audio detected, video too short (<2s), calibration missing
- `422` — landmark data malformed
- `500` — Basic Pitch failure

### `GET /health`
Returns `{ "status": "ok" }` — for dev sanity checks.

---

## 7. Data Models

### Calibration (stored in localStorage)
```ts
type Calibration = {
  x: number;        // px from left of video frame
  y: number;        // px from top
  width: number;
  height: number;
}
```

### Landmark Snapshot
```ts
type LandmarkSnapshot = {
  timestamp_ms: number;
  fingertips: Array<{ x: number; y: number }>; // normalized 0–1
}
```

### Note Event (backend output)
```ts
type NoteEvent = {
  time_s: number;
  string: 0 | 1 | 2 | 3 | 4 | 5;  // 0 = low E, 5 = high e
  fret: number;   // 0–24
}
```

---

## 8. Environment & Setup

### Frontend
```
Node 20+
npm install
npm run dev   → http://localhost:5173
```

Required env: none (no API keys)

### Backend
```
Python 3.11
pip install fastapi uvicorn python-multipart basic-pitch librosa soundfile opencv-python ffmpeg-python
uvicorn main:app --reload --port 8000
```

CORS: allow `http://localhost:5173` in development.

### MediaPipe Model File
Download `hand_landmarker.task` from:
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`
Place in `frontend/public/`.

---

## 9. Known Limitations (v1)

| Limitation | Impact |
|---|---|
| Single-note lines only | Chords will produce unreliable output |
| Hammer-ons / pull-offs | CV can't detect — may appear as missing notes |
| Camera angle dependency | Top-angled or side view of neck works best; front-on view causes finger occlusion |
| BPM detection is approximate | Tab grid quantization may be slightly off for rubato playing |
| No real-time preview | User must stop and submit before seeing any tab |

---

## 10. Future Scope (out of v1)

- Real-time tab preview during recording
- Technique annotations (h for hammer-on, p for pull-off, b for bend)
- BPM tap tempo input for better quantization
- Multiple takes + merge
- MIDI export
- Mobile webcam support