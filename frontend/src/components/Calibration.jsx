import { useEffect, useRef, useState } from "react";

const HANDLE_OFFSET = 28; // px above the top edge
const HANDLE_RADIUS = 8;
const HANDLE_HIT_RADIUS = 14;

export default function Calibration({ onConfirm }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // interaction state lives in refs so handlers can read current values
  // without re-binding listeners on every render
  const modeRef = useRef("idle"); // "idle" | "drawing" | "rotating"
  const drawStartRef = useRef(null);

  const [error, setError] = useState(null);
  // box: { x, y, width, height, rotation } where rotation is degrees,
  // x/y is the top-left of the un-rotated rect, rotated about its center
  const [box, setBox] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function initStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setError(
          "Camera access denied. Please allow permissions and reload the page."
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
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    function syncSize() {
      const r = video.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      canvas.width = r.width;
      canvas.height = r.height;
      redraw();
    }

    syncSize();
    video.addEventListener("loadedmetadata", syncSize);
    window.addEventListener("resize", syncSize);
    return () => {
      video.removeEventListener("loadedmetadata", syncSize);
      window.removeEventListener("resize", syncSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  function getCenter(b) {
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  }

  function getHandlePos(b) {
    const { cx, cy } = getCenter(b);
    const rad = (b.rotation * Math.PI) / 180;
    const localY = -b.height / 2 - HANDLE_OFFSET;
    // rotate (0, localY) by `rad` then translate to center
    const dx = -Math.sin(rad) * localY;
    const dy = Math.cos(rad) * localY;
    return { x: cx + dx, y: cy + dy };
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!box || box.width <= 0 || box.height <= 0) return;

    const { cx, cy } = getCenter(box);
    const rad = (box.rotation * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);

    ctx.fillStyle = "rgba(34, 197, 94, 0.25)";
    ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
    ctx.strokeStyle = "rgb(34, 197, 94)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);

    // Stem from top edge to rotation handle
    ctx.beginPath();
    ctx.moveTo(0, -box.height / 2);
    ctx.lineTo(0, -box.height / 2 - HANDLE_OFFSET + HANDLE_RADIUS);
    ctx.stroke();

    // Rotation handle
    ctx.beginPath();
    ctx.arc(0, -box.height / 2 - HANDLE_OFFSET, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.strokeStyle = "rgb(34, 197, 94)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, e.clientY - rect.top)),
    };
  }

  function isOnHandle(p) {
    if (!box || box.width <= 0 || box.height <= 0) return false;
    const h = getHandlePos(box);
    const dx = p.x - h.x;
    const dy = p.y - h.y;
    return dx * dx + dy * dy <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS;
  }

  function handleMouseDown(e) {
    const p = getPos(e);

    if (isOnHandle(p)) {
      modeRef.current = "rotating";
      return;
    }

    modeRef.current = "drawing";
    drawStartRef.current = p;
    setBox({ x: p.x, y: p.y, width: 0, height: 0, rotation: 0 });
  }

  function handleMouseMove(e) {
    const mode = modeRef.current;
    if (mode === "idle") return;

    const p = getPos(e);

    if (mode === "drawing") {
      const s = drawStartRef.current;
      setBox({
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        width: Math.abs(p.x - s.x),
        height: Math.abs(p.y - s.y),
        rotation: 0,
      });
    } else if (mode === "rotating" && box) {
      const { cx, cy } = getCenter(box);
      // angle from box center to pointer, measured from "up" (negative y)
      const radFromUp = Math.atan2(p.y - cy, p.x - cx) + Math.PI / 2;
      let deg = (radFromUp * 180) / Math.PI;
      // normalize to (-180, 180]
      while (deg > 180) deg -= 360;
      while (deg <= -180) deg += 360;
      setBox({ ...box, rotation: deg });
    }
  }

  function handleMouseUp() {
    modeRef.current = "idle";
  }

  function handleReset() {
    localStorage.removeItem("tabr_calibration");
    modeRef.current = "idle";
    drawStartRef.current = null;
    setBox(null);
  }

  function handleConfirm() {
    if (!box || box.width < 5 || box.height < 5) return;
    const payload = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      rotation: Math.round(box.rotation * 10) / 10,
    };
    localStorage.setItem("tabr_calibration", JSON.stringify(payload));
    onConfirm?.();
  }

  const hasBox = box && box.width >= 5 && box.height >= 5;

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      <p className="text-center text-sm text-stone-400">
        Click and drag to draw a box over your guitar fretboard. Then drag the
        white handle above the box to rotate it.
      </p>

      <div className="relative w-full overflow-hidden rounded-xl border border-stone-800 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="block w-full"
        />
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="absolute inset-0 h-full w-full cursor-crosshair"
        />
      </div>

      {hasBox && (
        <div className="text-xs text-stone-500">
          rotation: {box.rotation.toFixed(1)}°
        </div>
      )}

      {error && (
        <div className="w-full rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleReset}
          className="rounded-md border border-stone-700 bg-stone-900 px-5 py-2.5 font-medium text-stone-200 transition hover:bg-stone-800"
        >
          Recalibrate
        </button>
        {hasBox && (
          <button
            onClick={handleConfirm}
            className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500"
          >
            Confirm
          </button>
        )}
      </div>
    </div>
  );
}
