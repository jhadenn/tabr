"""Audio extraction and pitch transcription for Tabr."""

from __future__ import annotations

import os
import tempfile
from typing import List, TypedDict

import ffmpeg
import soundfile as sf
from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import predict


SAMPLE_RATE = 22050
MIN_DURATION_S = 2.0
CONFIDENCE_THRESHOLD = 0.7


class NoteEvent(TypedDict):
    start_time_s: float
    end_time_s: float
    pitch_midi: int
    confidence: float


class ShortAudioError(Exception):
    """Raised when the input audio is shorter than the required minimum."""


class NoNotesDetectedError(Exception):
    """Raised when the pitch transcription returns no notes above threshold."""


class TranscriptionError(Exception):
    """Raised when Basic Pitch fails to process the audio."""


def _extract_audio(video_path: str, audio_path: str) -> None:
    """Decode the video's audio track into a 22.05 kHz mono WAV file."""
    (
        ffmpeg
        .input(video_path)
        .output(audio_path, ac=1, ar=SAMPLE_RATE, format="wav", vn=None)
        .overwrite_output()
        .run(quiet=True)
    )


def _audio_duration_s(audio_path: str) -> float:
    info = sf.info(audio_path)
    if info.samplerate <= 0:
        return 0.0
    return info.frames / float(info.samplerate)


def transcribe_video_bytes(video_bytes: bytes) -> List[NoteEvent]:
    """Extract audio from a video blob, run Basic Pitch, return filtered notes.

    Raises:
        ShortAudioError: video audio is shorter than MIN_DURATION_S.
        NoNotesDetectedError: no notes pass the confidence threshold.
        TranscriptionError: Basic Pitch (or audio extraction) failed.
    """
    tmp_dir = tempfile.mkdtemp(prefix="tabr_")
    video_path = os.path.join(tmp_dir, "input.webm")
    audio_path = os.path.join(tmp_dir, "audio.wav")

    try:
        with open(video_path, "wb") as f:
            f.write(video_bytes)

        try:
            _extract_audio(video_path, audio_path)
        except FileNotFoundError as exc:
            raise TranscriptionError(
                "ffmpeg binary not found on PATH. Install it (e.g. "
                "`winget install Gyan.FFmpeg` on Windows or `brew install ffmpeg` on macOS) "
                "and restart the server."
            ) from exc
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
            raise TranscriptionError(f"Audio extraction failed: {stderr}") from exc

        duration = _audio_duration_s(audio_path)
        if duration < MIN_DURATION_S:
            raise ShortAudioError(
                f"Audio is {duration:.2f}s, must be at least {MIN_DURATION_S}s."
            )

        try:
            _, _, note_events = predict(
                audio_path,
                model_or_model_path=ICASSP_2022_MODEL_PATH,
            )
        except Exception as exc:  # basic-pitch raises a variety of errors
            raise TranscriptionError(f"Basic Pitch failed: {exc}") from exc

        notes: List[NoteEvent] = []
        for event in note_events:
            # basic-pitch returns: (start_s, end_s, pitch_midi, amplitude, pitch_bends)
            start_s, end_s, pitch_midi, amplitude, *_ = event
            if amplitude > CONFIDENCE_THRESHOLD:
                notes.append(
                    NoteEvent(
                        start_time_s=float(start_s),
                        end_time_s=float(end_s),
                        pitch_midi=int(pitch_midi),
                        confidence=float(amplitude),
                    )
                )

        if not notes:
            raise NoNotesDetectedError("No notes detected above confidence threshold.")

        notes.sort(key=lambda n: n["start_time_s"])
        return notes
    finally:
        for path in (audio_path, video_path):
            try:
                os.remove(path)
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass
