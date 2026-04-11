import { useState, useRef, useEffect } from "react";

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE = (RAW_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");

const FLIGHTS = [
  { airline: "ANA", price: 580, stops: 0, dur: "7h 30m" },
  { airline: "Air India", price: 420, stops: 1, dur: "12h 45m" },
  { airline: "Singapore Airlines", price: 650, stops: 1, dur: "10h 20m" },
  { airline: "Emirates", price: 510, stops: 1, dur: "14h 10m" },
];
const HOTELS = [
  { name: "Hotel Gracery Shinjuku", r: 8.4, price: 120, area: "Shinjuku" },
  { name: "Tokyu Stay Shibuya", r: 8.1, price: 95, area: "Shibuya" },
  { name: "The Millennials", r: 7.8, price: 45, area: "Downtown" },
  { name: "Park Hyatt", r: 9.2, price: 380, area: "Shinjuku" },
];
const WEATHER = { temp: "28°C", hum: "72%", cond: "Warm & humid", tip: "Carry umbrella for summer showers" };

const SYS = `You are a friendly travel planning chatbot called TripScout built by Tejaswi.

Your job: help users plan trips through natural conversation. Be warm, short (under 80 words), and helpful.

When a user describes a trip, figure out:
- Where from, where to, dates, budget, travelers, interests

If info is missing, ask naturally. Don't ask everything at once. Always ask for dates if not provided — flights and hotels CANNOT be searched without dates.

CRITICAL RULE: Only add this EXACT tag at the END of your message when you have ALL THREE: origin, destination, AND departure date:
[SEARCH_READY]

NEVER add [SEARCH_READY] if you don't have specific travel dates yet. Ask for dates first.
Only add [SEARCH_READY] once per conversation — when you first have enough to search.

If user asks for itinerary/recommendations after results, give specific real place names, restaurant names, and tips.

Today is April 10, 2026. Never mention you are an AI unless asked.`;

export default function TravelBotDemo() {
  const [msgs, setMsgs] = useState([
    { from: "bot", text: "Hey! I'm your travel assistant. Just tell me where you want to go.\n\nTry: \"I want to visit Tokyo from Mumbai in July for a week, budget $2500, I love anime and ramen\"" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [searched, setSearched] = useState(false);
  const [pendingSearch, setPendingSearch] = useState(false);
  const endRef = useRef(null);
  const inpRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, loading]);

  const send = async (override) => {
    const t = (override || input).trim();
    if (!t || loading) return;
    if (!override) setInput("");

    setMsgs(p => [...p, { from: "user", text: t }]);
    const newHist = [...history, { role: "user", content: t }];
    setHistory(newHist);
    setLoading(true);

    // Check if user is confirming a pending search
    if (pendingSearch && !searched) {
      const lower = t.toLowerCase();
      const isYes = lower.includes("yes") || lower.includes("yeah") || lower.includes("sure") || lower.includes("go") || lower.includes("search") || lower.includes("find") || lower.includes("ok") || lower.includes("please") || lower.includes("do it") || lower.includes("let's");
      if (isYes) {
        setSearched(true);
        setPendingSearch(false);
        setMsgs(p => [...p, { from: "bot", text: "Searching flights, hotels, and weather..." }]);
        await new Promise(r => setTimeout(r, 1200));
        setMsgs(p => [...p, { from: "flights" }]);
        await new Promise(r => setTimeout(r, 800));
        setMsgs(p => [...p, { from: "hotels" }]);
        await new Promise(r => setTimeout(r, 800));
        setMsgs(p => [...p, { from: "weather" }]);
        await new Promise(r => setTimeout(r, 500));
        setMsgs(p => [...p, { from: "bot", text: "Here are your results! Want me to recommend the best option or plan a day-by-day itinerary?" }]);
        setHistory(p => [...p, { role: "assistant", content: "I've shown flights, hotels, and weather results. I should now help the user choose or plan an itinerary." }]);
        setLoading(false);
        inpRef.current?.focus();
        return;
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newHist,
          trip_context: {},
        }),
      });

      const data = await res.json();
      let reply = data.reply || "Sorry, I couldn't process that. Try again!";
      const tripReady = data.trip_data && data.trip_data.ready && !searched && !pendingSearch;
      if (tripReady) {
        reply += "\n\nShall I search for flights, hotels, and weather now?";
        setPendingSearch(true);
      }

      setMsgs(p => [...p, { from: "bot", text: reply }]);
      setHistory(p => [...p, { role: "assistant", content: reply }]);

    } catch (e) {
      setMsgs(p => [...p, { from: "bot", text: "Hmm, something went wrong. Try sending your message again!" }]);
    }

    setLoading(false);
    inpRef.current?.focus();
  };

  const chip = (t) => { setInput(""); send(t); };

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#0A0A10", color: "#E0DED8", height: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&display=swap');
        @keyframes fu { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes bn { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
        * { box-sizing:border-box; margin:0; padding:0 }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
        input:focus{outline:none}
      `}</style>

      {/* Header */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #1E1E2A", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: "#0E0E16" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #6C5CE7, #00B894)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#fff", fontWeight: 800 }}>◈</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>TripScout</div>
            <div style={{ fontSize: 10, color: "#666" }}>by Tejaswi· Smart travel,Simple Planning</div>
          </div>
        </div>
        <button onClick={() => { setMsgs([{ from: "bot", text: "Fresh start! Where would you like to go?" }]); setHistory([]); setSearched(false); setPendingSearch(false); }} style={{ background: "#1A1A24", border: "1px solid #2A2A38", borderRadius: 8, padding: "6px 14px", fontSize: 11, cursor: "pointer", color: "#aaa", fontWeight: 600 }}>New chat</button>
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 14px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {msgs.map((m, i) => {
            if (m.from === "bot") return (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 14, animation: "fu 0.3s ease" }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg, #6C5CE7, #00B894)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 800 }}>◈</div>
                <div style={{ background: "#1A1A24", border: "1px solid #252530", borderRadius: "4px 14px 14px 14px", padding: "11px 15px", fontSize: 13.5, lineHeight: 1.65, color: "#E0DED8", maxWidth: "82%", whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            );
            if (m.from === "user") return (
              <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14, animation: "fu 0.3s ease" }}>
                <div style={{ background: "#6C5CE7", borderRadius: "14px 4px 14px 14px", padding: "11px 15px", fontSize: 13.5, lineHeight: 1.65, color: "#fff", maxWidth: "82%", whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            );
            if (m.from === "flights") return (
              <div key={i} style={{ margin: "6px 0 14px 40px", padding: 12, background: "#12121A", border: "1px solid #252530", borderRadius: 12, animation: "fu 0.4s ease" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#0984E3", letterSpacing: "0.06em", marginBottom: 8 }}>△ {FLIGHTS.length} flights found</div>
                {FLIGHTS.map((f, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, marginBottom: 3, background: j === 0 ? "#0984E310" : "transparent", border: j === 0 ? "1px solid #0984E325" : "1px solid transparent" }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#E0DED8" }}>{f.airline}</div>
                      <div style={{ fontSize: 10.5, color: "#666", marginTop: 1 }}>{f.dur} · {f.stops === 0 ? "Non-stop" : f.stops + " stop"}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#0984E3" }}>${f.price}</div>
                  </div>
                ))}
              </div>
            );
            if (m.from === "hotels") return (
              <div key={i} style={{ margin: "6px 0 14px 40px", padding: 12, background: "#12121A", border: "1px solid #252530", borderRadius: 12, animation: "fu 0.4s ease" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#E17055", letterSpacing: "0.06em", marginBottom: 8 }}>□ {HOTELS.length} hotels found</div>
                {HOTELS.map((h, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, marginBottom: 3, background: j === 0 ? "#E1705510" : "transparent", border: j === 0 ? "1px solid #E1705525" : "1px solid transparent" }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#E0DED8" }}>{h.name}</div>
                      <div style={{ fontSize: 10.5, color: "#666", marginTop: 1 }}>★ {h.r} · {h.area}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#E17055" }}>${h.price}<span style={{ fontSize: 10, fontWeight: 400, color: "#666" }}>/night</span></div>
                  </div>
                ))}
              </div>
            );
            if (m.from === "weather") return (
              <div key={i} style={{ margin: "6px 0 14px 40px", padding: 12, background: "#FDCB6E08", border: "1px solid #FDCB6E20", borderRadius: 12, animation: "fu 0.4s ease" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#FDCB6E", textTransform: "uppercase", marginBottom: 6 }}>○ Weather</div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
                  <span style={{ color: "#E0DED8", fontWeight: 700 }}>{WEATHER.temp}</span>
                  <span style={{ color: "#888" }}>{WEATHER.hum} humidity</span>
                  <span style={{ color: "#888" }}>{WEATHER.cond}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "#B7950B", marginTop: 6 }}>{WEATHER.tip}</div>
              </div>
            );
            return null;
          })}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg, #6C5CE7, #00B894)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 800 }}>◈</div>
              <div style={{ background: "#1A1A24", border: "1px solid #252530", borderRadius: "4px 14px 14px 14px", padding: "11px 18px", display: "flex", gap: 5, alignItems: "center" }}>
                {[0, 0.15, 0.3].map((d, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#555", animation: `bn 1s infinite ${d}s` }} />)}
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* Quick suggestions */}
      {msgs.length <= 2 && !loading && (
        <div style={{ padding: "0 14px 8px", flexShrink: 0 }}>
          <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {[
              "Plan a trip to Paris from Delhi in June, budget $3000",
              "I want to visit Bali for a honeymoon",
              "Weekend trip to Dubai from Mumbai",
              "Backpacking trip to Thailand",
            ].map((s, i) => (
              <button key={i} onClick={() => chip(s)} style={{ padding: "7px 14px", borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: "#1A1A24", border: "1px solid #2A2A38", color: "#999", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "10px 14px 14px", borderTop: "1px solid #1E1E2A", background: "#0E0E16", flexShrink: 0 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 8 }}>
          <input
            ref={inpRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Tell me where you want to go..."
            style={{ flex: 1, padding: "12px 16px", borderRadius: 12, border: "1px solid #252530", background: "#12121A", fontSize: 14, color: "#E0DED8", fontFamily: "inherit" }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            style={{ padding: "12px 20px", borderRadius: 12, border: "none", background: loading || !input.trim() ? "#333" : "linear-gradient(135deg, #6C5CE7, #00B894)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading || !input.trim() ? "default" : "pointer" }}
          >Send</button>
        </div>
      </div>
    </div>
  );
}
