import { useState } from "react";
import Calibration from "./components/Calibration";
import Recorder from "./components/Recorder";

export default function App() {
  const [calibrated, setCalibrated] = useState(
    () => !!localStorage.getItem("tabr_calibration")
  );

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-stone-950 px-6 py-12 text-stone-50">
      <h1 className="text-5xl font-semibold tracking-tight">Tabr</h1>
      {calibrated ? (
        <Recorder onRecalibrate={() => setCalibrated(false)} />
      ) : (
        <Calibration onConfirm={() => setCalibrated(true)} />
      )}
    </main>
  );
}
