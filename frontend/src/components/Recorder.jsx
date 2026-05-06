import { useEffect, useRef, useState } from "react";

export default function Recorder() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [status, setStatus] = useState("idle"); // "idle" | "recording" | "stopped"
  const [error, setError] = useState(null);

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

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      console.log("Blob size:", blob.size);
      setStatus("stopped");
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setStatus("recording");
  };

  const stopAndSubmit = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      <div className="relative w-full overflow-hidden rounded-xl border border-stone-800 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full"
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

      <div className="flex gap-3">
        {status !== "recording" && (
          <button
            onClick={startRecording}
            disabled={!!error}
            className="rounded-md bg-red-600 px-5 py-2.5 font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-stone-700"
          >
            Start Recording
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
      </div>
    </div>
  );
}
