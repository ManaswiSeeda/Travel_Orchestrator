
import { useState, useRef, useEffect } from "react";

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE = (RAW_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");

export default function TravelBot() {
  const [msgs, setMsgs] = useState([
    {
      from: "bot",
      text: "Hey! I'm TripScout, your travel assistant. Just tell me where you want to go.\n\nTry: \"I want to visit Tokyo from Mumbai in July for a week, budget $2500, I love anime and ramen\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [searched, setSearched] = useState(false);
  const [pendingSearch, setPendingSearch] = useState(false);
  const [pendingTrip, setPendingTrip] = useState(null);
  const endRef = useRef(null);
  const inpRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  // Fetch real data from backend
  const fetchRealData = async (tripData) => {
    const { origin, destination, departure_date, return_date, adults = 1 } = tripData;

    setMsgs((p) => [...p, { from: "bot", text: "Searching real-time flights, hotels, and weather for you..." }]);

    const results = { flights: null, hotels: null, climate: null };

    // Flights
    try {
      const params = new URLSearchParams({
        origin,
        destination,
        departure_date,
        adults: String(adults),
        ...(return_date ? { return_date } : {}),
      });
      const res = await fetch(`${API_BASE}/api/flights?${params}`);
      const data = await res.json();
      results.flights = data.flights || [];
    } catch {
      results.flights = [];
    }

    // Hotels (only if we have a return date)
    if (return_date) {
      try {
        const params = new URLSearchParams({
          destination,
          checkin_date: departure_date,
          checkout_date: return_date,
          adults: String(adults),
        });
        const res = await fetch(`${API_BASE}/api/hotels?${params}`);
        const data = await res.json();
        results.hotels = data.hotels || [];
      } catch {
        results.hotels = [];
      }
    }

    // Climate
    try {
      const params = new URLSearchParams({ city: destination });
      const res = await fetch(`${API_BASE}/api/climate?${params}`);
      const data = await res.json();
      results.climate = data;
    } catch {
      results.climate = null;
    }

    // Render results
    if (results.flights !== null) {
      setMsgs((p) => [...p, { from: "flights", data: results.flights }]);
    }
    if (results.hotels !== null) {
      setMsgs((p) => [...p, { from: "hotels", data: results.hotels }]);
    }
    if (results.climate) {
      setMsgs((p) => [...p, { from: "weather", data: results.climate }]);
    }

    const hasResults =
      (results.flights && results.flights.length > 0) ||
      (results.hotels && results.hotels.length > 0) ||
      results.climate;

    setMsgs((p) => [
      ...p,
      {
        from: "bot",
        text: hasResults
          ? "Here are your live results! Want me to recommend the best option or build a day-by-day itinerary?"
          : "I couldn't fetch live results right now — the APIs may be rate-limited or the route might not be supported. Want to try different dates or a different route?",
      },
    ]);

    setHistory((p) => [
      ...p,
      {
        role: "assistant",
        content: "I've fetched and shown live flights, hotels, and weather. I should now help the user choose or plan an itinerary.",
      },
    ]);
  };

  const send = async (override) => {
    const t = (override || input).trim();
    if (!t || loading) return;
    if (!override) setInput("");

    setMsgs((p) => [...p, { from: "user", text: t }]);
    const newHist = [...history, { role: "user", content: t }];
    setHistory(newHist);
    setLoading(true);

    // User confirming a pending search?
    if (pendingSearch && !searched && pendingTrip) {
      const lower = t.toLowerCase();
      const isYes =
        lower.includes("yes") ||
        lower.includes("yeah") ||
        lower.includes("sure") ||
        lower.includes("go") ||
        lower.includes("search") ||
        lower.includes("find") ||
        lower.includes("ok") ||
        lower.includes("please") ||
        lower.includes("do it") ||
        lower.includes("let's");

      if (isYes) {
        setSearched(true);
        setPendingSearch(false);
        setLoading(false);
        await fetchRealData(pendingTrip);
        inpRef.current?.focus();
        return;
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHist, trip_context: {} }),
      });

      const data = await res.json();
      let reply = data.reply || "Sorry, I couldn't process that. Try again!";
      const tripData = data.trip_data;
      const tripReady = tripData?.ready && !searched && !pendingSearch;

      if (tripReady) {
        reply += "\n\nShall I search for live flights, hotels, and weather now?";
        setPendingSearch(true);
        setPendingTrip(tripData);
      }

      setMsgs((p) => [...p, { from: "bot", text: reply }]);
      setHistory((p) => [...p, { role: "assistant", content: reply }]);
    } catch {
      setMsgs((p) => [
        ...p,
        { from: "bot", text: "Hmm, something went wrong. Try sending your message again!" },
      ]);
    }

    setLoading(false);
    inpRef.current?.focus();
  };

  const chip = (t) => send(t);

  const resetChat = () => {
    setMsgs([{ from: "bot", text: "Fresh start! Where would you like to go?" }]);
    setHistory([]);
    setSearched(false);
    setPendingSearch(false);
    setPendingTrip(null);
    setInput("");
  };

  return (
    <div
      style={{
        fontFamily: "'DM Sans', system-ui, sans-serif",
        background: "#0A0A10",
        color: "#E0DED8",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&display=swap');
        @keyframes fu { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes bn { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
        * { box-sizing:border-box; margin:0; padding:0 }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
        input:focus{outline:none}
      `}</style>

      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #1E1E2A",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          background: "#0E0E16",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "linear-gradient(135deg, #6C5CE7, #00B894)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              color: "#fff",
              fontWeight: 800,
            }}
          >
            ◈
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>TripScout</div>
            <div style={{ fontSize: 10, color: "#666" }}>Smart travel · Live data</div>
          </div>
        </div>
        <button
          onClick={resetChat}
          style={{
            background: "#1A1A24",
            border: "1px solid #2A2A38",
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 11,
            cursor: "pointer",
            color: "#aaa",
            fontWeight: 600,
          }}
        >
          New chat
        </button>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 14px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {msgs.map((m, i) => {
            if (m.from === "bot")
              return (
                <div
                  key={i}
                  style={{ display: "flex", gap: 10, marginBottom: 14, animation: "fu 0.3s ease" }}
                >
                  <BotAvatar />
                  <div
                    style={{
                      background: "#1A1A24",
                      border: "1px solid #252530",
                      borderRadius: "4px 14px 14px 14px",
                      padding: "11px 15px",
                      fontSize: 13.5,
                      lineHeight: 1.65,
                      color: "#E0DED8",
                      maxWidth: "82%",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              );

            if (m.from === "user")
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 14,
                    animation: "fu 0.3s ease",
                  }}
                >
                  <div
                    style={{
                      background: "#6C5CE7",
                      borderRadius: "14px 4px 14px 14px",
                      padding: "11px 15px",
                      fontSize: 13.5,
                      lineHeight: 1.65,
                      color: "#fff",
                      maxWidth: "82%",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              );

            if (m.from === "flights")
              return <FlightsCard key={i} flights={m.data} />;

            if (m.from === "hotels")
              return <HotelsCard key={i} hotels={m.data} />;

            if (m.from === "weather")
              return <WeatherCard key={i} climate={m.data} />;

            return null;
          })}

          {loading && (
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <BotAvatar />
              <div
                style={{
                  background: "#1A1A24",
                  border: "1px solid #252530",
                  borderRadius: "4px 14px 14px 14px",
                  padding: "11px 18px",
                  display: "flex",
                  gap: 5,
                  alignItems: "center",
                }}
              >
                {[0, 0.15, 0.3].map((d, i) => (
                  <div
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#555",
                      animation: `bn 1s infinite ${d}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Quick chips */}
      {msgs.length <= 2 && !loading && (
        <div style={{ padding: "0 14px 8px", flexShrink: 0 }}>
          <div
            style={{
              maxWidth: 640,
              margin: "0 auto",
              display: "flex",
              gap: 6,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {[
              "Plan a trip to Paris from Delhi in June, budget $3000",
              "I want to visit Bali for a honeymoon",
              "Weekend trip to Dubai from Mumbai",
              "Backpacking trip to Thailand",
            ].map((s, i) => (
              <button
                key={i}
                onClick={() => chip(s)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 20,
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: "#1A1A24",
                  border: "1px solid #2A2A38",
                  color: "#999",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: "10px 14px 14px",
          borderTop: "1px solid #1E1E2A",
          background: "#0E0E16",
          flexShrink: 0,
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 8 }}>
          <input
            ref={inpRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Tell me where you want to go..."
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid #252530",
              background: "#12121A",
              fontSize: 14,
              color: "#E0DED8",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            style={{
              padding: "12px 20px",
              borderRadius: 12,
              border: "none",
              background:
                loading || !input.trim()
                  ? "#333"
                  : "linear-gradient(135deg, #6C5CE7, #00B894)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: loading || !input.trim() ? "default" : "pointer",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function BotAvatar() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 10,
        flexShrink: 0,
        background: "linear-gradient(135deg, #6C5CE7, #00B894)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: "#fff",
        fontWeight: 800,
      }}
    >
      ◈
    </div>
  );
}

function FlightsCard({ flights }) {
  if (!flights || flights.length === 0)
    return (
      <ResultShell color="#0984E3" label="△ Flights" note="No flights found for this route / dates.">
        <div style={{ fontSize: 12, color: "#666" }}>Try different dates or airports.</div>
      </ResultShell>
    );

  return (
    <ResultShell color="#0984E3" label={`△ ${flights.length} flights found`}>
      {flights.slice(0, 5).map((f, j) => (
        <div
          key={j}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: 8,
            marginBottom: 3,
            background: j === 0 ? "#0984E310" : "transparent",
            border: j === 0 ? "1px solid #0984E325" : "1px solid transparent",
          }}
        >
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#E0DED8" }}>
              {f.airline || f.owner || "Unknown airline"}
            </div>
            <div style={{ fontSize: 10.5, color: "#666", marginTop: 1 }}>
              {f.duration || f.dur || ""}
              {f.stops !== undefined ? ` · ${f.stops === 0 ? "Non-stop" : f.stops + " stop(s)"}` : ""}
            </div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#0984E3" }}>
            {f.formattedPrice || (f.price ? `$${f.price}` : "—")}
          </div>
        </div>
      ))}
    </ResultShell>
  );
}

function HotelsCard({ hotels }) {
  if (!hotels || hotels.length === 0)
    return (
      <ResultShell color="#E17055" label="□ Hotels" note="No hotels found.">
        <div style={{ fontSize: 12, color: "#666" }}>Try different dates.</div>
      </ResultShell>
    );

  return (
    <ResultShell color="#E17055" label={`□ ${hotels.length} hotels found`}>
      {hotels.slice(0, 5).map((h, j) => (
        <div
          key={j}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: 8,
            marginBottom: 3,
            background: j === 0 ? "#E1705510" : "transparent",
            border: j === 0 ? "1px solid #E1705525" : "1px solid transparent",
          }}
        >
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#E0DED8" }}>{h.name}</div>
            <div style={{ fontSize: 10.5, color: "#666", marginTop: 1 }}>
              {h.rating ? `★ ${h.rating}` : ""}
              {h.area ? ` · ${h.area}` : ""}
            </div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#E17055" }}>
            {h.formattedPrice || (h.price ? `${h.currency || "$"}${h.price}` : "—")}
            <span style={{ fontSize: 10, fontWeight: 400, color: "#666" }}>/night</span>
          </div>
        </div>
      ))}
    </ResultShell>
  );
}

function WeatherCard({ climate }) {
  if (!climate) return null;
  return (
    <div
      style={{
        margin: "6px 0 14px 40px",
        padding: 12,
        background: "#FDCB6E08",
        border: "1px solid #FDCB6E20",
        borderRadius: 12,
        animation: "fu 0.4s ease",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#FDCB6E",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        ○ Weather at destination
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
        {climate.temp && <span style={{ color: "#E0DED8", fontWeight: 700 }}>{climate.temp}</span>}
        {climate.humidity && <span style={{ color: "#888" }}>{climate.humidity} humidity</span>}
        {climate.condition && <span style={{ color: "#888", textTransform: "capitalize" }}>{climate.condition}</span>}
        {climate.windSpeed !== undefined && <span style={{ color: "#888" }}>💨 {climate.windSpeed} m/s</span>}
      </div>
      {climate.advisory && (
        <div style={{ fontSize: 10.5, color: "#B7950B", marginTop: 6 }}>{climate.advisory}</div>
      )}
    </div>
  );
}

function ResultShell({ color, label, children }) {
  return (
    <div
      style={{
        margin: "6px 0 14px 40px",
        padding: 12,
        background: "#12121A",
        border: "1px solid #252530",
        borderRadius: 12,
        animation: "fu 0.4s ease",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          color,
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
