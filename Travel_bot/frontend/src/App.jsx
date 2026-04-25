import { useState } from "react";
import TravelBot from "./TravelBot";

export default function App() {
  const [mode, setMode] = useState("bot");

  return (
    <div style={{ position: "relative" }}>
      {/* Mode toggle */}
      <div style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 100,
        display: "flex", borderRadius: 12, overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        border: "1px solid #333",
      }}>
        <button
          onClick={() => setMode("bot")}
          style={{
            padding: "10px 16px", border: "none", fontSize: 12, fontWeight: 700,
            cursor: "pointer",
            background: mode === "bot" ? "#6C5CE7" : "#1A1A24",
            color: mode === "bot" ? "#fff" : "#888",
          }}
        >
          ◈ Chat Bot
        </button>
      </div>

      {mode === "bot" ? <TravelBot /> : <TravelAgent />}
    </div>
  );
}
