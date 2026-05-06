import logging
import traceback

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from audio_processor import (
    NoNotesDetectedError,
    ShortAudioError,
    TranscriptionError,
    transcribe_video_bytes,
)

logger = logging.getLogger("tabr")

app = FastAPI(title="Tabr API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Catch-all so unexpected errors still return CORS-tagged JSON,
    not a bare 500 that the browser misreads as a CORS failure."""
    logger.error("Unhandled exception:\n%s", traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process")
async def process(video: UploadFile = File(...)) -> dict:
    video_bytes = await video.read()
    if not video_bytes:
        raise HTTPException(status_code=400, detail="Empty video upload.")

    try:
        notes = transcribe_video_bytes(video_bytes)
    except ShortAudioError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except NoNotesDetectedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except TranscriptionError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"notes": notes}
