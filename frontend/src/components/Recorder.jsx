import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const FINGERTIP_INDICES = [4, 8, 12, 16, 20];
const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export default function Recorder({ onRecalibrate }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const landmarksRef = useRef([]);
  const handLandmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const frameCounterRef = useRef(0);
  const recordingStartRef = useRef(0);
  const isRecordingRef = useRef(false);

  // "idle" | "recording" | "processing" | "done" | "error"
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [lastBlobUrl, setLastBlobUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function initStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError(
          "Camera and microphone access denied. Please allow permissions and reload the page."
        );
      }
    }

    initStream();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initLandmarker() {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        handLandmarkerRef.current = landmarker;
      } catch (err) {
        console.error("HandLandmarker init failed", err);
      }
    }

    initLandmarker();

    return () => {
      cancelled = true;
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    function syncSize() {
      const r = video.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      canvas.width = r.width;
      canvas.height = r.height;
    }

    syncSize();
    video.addEventListener("loadedmetadata", syncSize);
    window.addEventListener("resize", syncSize);
    return () => {
      video.removeEventListener("loadedmetadata", syncSize);
      window.removeEventListener("resize", syncSize);
    };
  }, []);

  // Revoke object URL when it changes / unmounts
  useEffect(() => {
    return () => {
      if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    };
  }, [lastBlobUrl]);

  const detectionTick = () => {
    if (!isRecordingRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = handLandmarkerRef.current;

    if (video && canvas && landmarker && video.readyState >= 2) {
      frameCounterRef.current += 1;
      if (frameCounterRef.current % 2 === 0) {
        const now = performance.now();
        try {
          const result = landmarker.detectForVideo(video, now);
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (result.landmarks && result.landmarks.length > 0) {
            const hand = result.landmarks[0];
            const fingertips = FINGERTIP_INDICES.map((i) => ({
              x: hand[i].x,
              y: hand[i].y,
            }));

            landmarksRef.current.push({
              timestamp_ms: now - recordingStartRef.current,
              fingertips,
            });

            ctx.fillStyle = "rgb(34, 197, 94)";
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            for (const ft of fingertips) {
              const cx = ft.x * canvas.width;
              const cy = ft.y * canvas.height;
              ctx.beginPath();
              ctx.arc(cx, cy, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
        } catch (err) {
          // detectForVideo can throw if timestamps regress; skip this frame
        }
      }
    }

    rafRef.current = requestAnimationFrame(detectionTick);
  };

  const stopDetectionLoop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const uploadBlob = async (blob) => {
    setStatus("processing");
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("video", blob, "recording.webm");

    try {
      const res = await fetch(`${BACKEND_URL}/process`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail = data?.detail || `HTTP ${res.status}`;
        throw new Error(detail);
      }

      setResult(data);
      setStatus("done");
      console.log("Backend response:", data);
    } catch (err) {
      console.error("Upload failed:", err);
      setError(err.message || "Upload failed");
      setStatus("error");
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];
    landmarksRef.current = [];
    frameCounterRef.current = 0;
    recordingStartRef.current = performance.now();

    if (lastBlobUrl) {
      URL.revokeObjectURL(lastBlobUrl);
      setLastBlobUrl(null);
    }
    setResult(null);
    setError(null);

    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      console.log(
        "Blob size:",
        blob.size,
        "Landmarks captured:",
        landmarksRef.current.length
      );
      setLastBlobUrl(URL.createObjectURL(blob));
      uploadBlob(blob);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    isRecordingRef.current = true;
    setStatus("recording");
    rafRef.current = requestAnimationFrame(detectionTick);
  };

  const stopAndSubmit = () => {
    isRecordingRef.current = false;
    stopDetectionLoop();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const handleRecalibrate = () => {
    localStorage.removeItem("tabr_calibration");
    onRecalibrate?.();
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      <div className="relative w-full overflow-hidden rounded-xl border border-stone-800 bg-black">
        <button
          onClick={handleRecalibrate}
          className="absolute right-3 top-3 z-10 rounded-md bg-black/60 px-2.5 py-1 text-xs text-stone-200 underline-offset-2 transition hover:bg-black/80 hover:underline"
        >
          Recalibrate
        </button>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="block w-full"
          style={{ transform: "scaleX(-1)" }}
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ transform: "scaleX(-1)" }}
        />
        {status === "recording" && (
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            Recording
          </div>
        )}
      </div>

      {error && (
        <div className="w-full rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {status === "processing" && (
        <div className="w-full rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-300">
          Processing audio… (Basic Pitch can take 5–20s on first run)
        </div>
      )}

      {status === "done" && result?.notes && (
        <div className="w-full rounded-md border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
          <div className="font-medium">
            Detected {result.notes.length} note{result.notes.length === 1 ? "" : "s"}.
          </div>
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/40 p-2 text-xs text-emerald-200">
            {JSON.stringify(result.notes.slice(0, 10), null, 2)}
            {result.notes.length > 10 ? "\n…" : ""}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {status !== "recording" && status !== "processing" && (
          <button
            onClick={startRecording}
            disabled={!!error && status !== "error"}
            className="rounded-md bg-red-600 px-5 py-2.5 font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-stone-700"
          >
            {status === "idle" ? "Start Recording" : "Record Again"}
          </button>
        )}
        {status === "recording" && (
          <button
            onClick={stopAndSubmit}
            className="rounded-md bg-stone-200 px-5 py-2.5 font-medium text-stone-900 transition hover:bg-white"
          >
            Stop & Submit
          </button>
        )}
        {lastBlobUrl && status !== "recording" && (
          <a
            href={lastBlobUrl}
            download="tabr-recording.webm"
            className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:bg-stone-900"
          >
            Download last recording
          </a>
        )}
      </div>
    </div>
  );
}
