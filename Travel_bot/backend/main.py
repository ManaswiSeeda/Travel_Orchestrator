from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
import os
from anthropic import Anthropic
import json

load_dotenv()

app = FastAPI(title="TripScout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
SKY_HOST = os.getenv("SKY_HOST", "")
BOOKING_HOST = os.getenv("BOOKING_HOST", "booking-com15.p.rapidapi.com")
WEATHER_HOST = os.getenv("WEATHER_HOST", "open-weather13.p.rapidapi.com")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")


def rapid_headers(host: str) -> dict:
    return {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": host,
    }


def debug_log(label: str, url: str, params: dict | None = None):
    print("\n===== API DEBUG =====")
    print("LABEL:", label)
    print("URL:", url)
    print("PARAMS:", params or {})
    print("=====================\n")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "rapidapi_key_loaded": bool(RAPIDAPI_KEY),
        "sky_host": SKY_HOST,
        "booking_host": BOOKING_HOST,
        "weather_host": WEATHER_HOST,
    }


# -- Flights (Google Flights via RapidAPI) -------------------------------------

@app.get("/api/flights")
async def search_flights(
    origin: str = Query(...),
    destination: str = Query(...),
    departure_date: str = Query(...),
    return_date: str | None = Query(None),
    adults: int = Query(1),
    cabin_class: str = Query("economy"),
):
    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="Missing RAPIDAPI_KEY")

    def extract_iata(value: str) -> str:
        v = value.strip()
        if "(" in v and ")" in v:
            return v.split("(")[-1].replace(")", "").strip()
        return v

    origin_code = extract_iata(origin)
    dest_code = extract_iata(destination)

    cabin_map = {
        "economy": "ECONOMY",
        "premium economy": "PREMIUM_ECONOMY",
        "premium_economy": "PREMIUM_ECONOMY",
        "business": "BUSINESS",
        "first": "FIRST",
    }
    travel_class = cabin_map.get(cabin_class.lower().strip(), "ECONOMY")

    params = {
        "departure_id": origin_code,
        "arrival_id": dest_code,
        "outbound_date": departure_date,
        "adults": adults,
        "travel_class": travel_class,
        "currency": "USD",
    }
    if return_date:
        params["return_date"] = return_date

    url = f"https://{SKY_HOST}/api/v1/searchFlights"
    debug_log("GOOGLE FLIGHTS SEARCH", url, params)

    # Google Flights aggregates live data — can take up to 15s
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(url, params=params, headers=rapid_headers(SKY_HOST))

        if res.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Google Flights search failed ({res.status_code}): {res.text}",
            )

        raw = res.json()
        itineraries = raw.get("data", {}).get("itineraries", {})
        top = itineraries.get("topFlights", []) or []
        other = itineraries.get("other_flights", []) or []
        all_results = (top + other)[:10]

        print(f"GOOGLE FLIGHTS COUNT: {len(all_results)}")

        def mins_to_text(minutes):
            if not minutes:
                return ""
            return f"{int(minutes) // 60}h {int(minutes) % 60}m"

        flights = []
        for item in all_results:
            if not isinstance(item, dict):
                continue
            airlines = item.get("airlines", [])
            airline_name = ", ".join(airlines) if airlines else "Unknown Airline"
            price = item.get("price", 0)
            stops = item.get("stops", 0)
            dep_time = item.get("departure_time", "")
            arr_time = item.get("arrival_time", "")
            duration_mins = item.get("duration", 0)
            flights.append({
                "airline": airline_name,
                "dep": dep_time,
                "arr": arr_time,
                "stops": stops,
                "duration": mins_to_text(duration_mins),
                "price": price,
                "formattedPrice": f"USD {price:.2f}" if price else "N/A",
                "origin": origin,
                "destination": destination,
            })

        return {"flights": flights, "source": "google_flights"}


# -- Hotels (Booking.com via RapidAPI) -----------------------------------------

@app.get("/api/hotels")
async def search_hotels(
    destination: str = Query(...),
    checkin_date: str = Query(...),
    checkout_date: str = Query(...),
    adults: int = Query(1),
    room_qty: int = Query(1),
):
    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="Missing RAPIDAPI_KEY")

    async with httpx.AsyncClient(timeout=40) as client:
        destination_url = f"https://{BOOKING_HOST}/api/v1/hotels/searchDestination"
        destination_params = {"query": destination}
        debug_log("HOTEL DESTINATION SEARCH", destination_url, destination_params)

        dest_res = await client.get(
            destination_url, params=destination_params, headers=rapid_headers(BOOKING_HOST)
        )
        if dest_res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Destination search failed: {dest_res.text}")

        dest_json = dest_res.json()
        destinations = dest_json.get("data", [])
        if not destinations:
            raise HTTPException(status_code=404, detail="No hotel destination found")

        first_dest = destinations[0]
        dest_id = first_dest.get("dest_id")
        search_type = first_dest.get("search_type")
        if not dest_id or not search_type:
            raise HTTPException(status_code=500, detail="dest_id/search_type missing")

        hotel_url = f"https://{BOOKING_HOST}/api/v1/hotels/searchHotels"
        hotel_params = {
            "dest_id": dest_id,
            "search_type": search_type,
            "arrival_date": checkin_date,
            "departure_date": checkout_date,
            "adults": adults,
            "room_qty": room_qty,
            "page_number": 1,
            "units": "metric",
            "temperature_unit": "c",
            "languagecode": "en-us",
            "currency_code": "USD",
        }
        debug_log("HOTEL SEARCH", hotel_url, hotel_params)

        hotel_res = await client.get(
            hotel_url, params=hotel_params, headers=rapid_headers(BOOKING_HOST)
        )
        if hotel_res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Hotel search failed: {hotel_res.text}")

        raw = hotel_res.json()
        results = raw.get("data", {}).get("hotels", []) or raw.get("data", [])

        hotels = []
        for item in results[:10]:
            prop = item.get("property", item)
            gross = prop.get("priceBreakdown", {}).get("grossPrice", {})
            hotels.append({
                "name": prop.get("name", "Unknown Hotel"),
                "rating": prop.get("reviewScore", 0),
                "price": gross.get("value", 0),
                "formattedPrice": (
                    f"{gross.get('currency')} {gross.get('value')}"
                    if gross.get("currency") and gross.get("value")
                    else ""
                ),
                "currency": gross.get("currency", "USD"),
                "area": prop.get("wishlistName", destination),
                "amenities": [],
            })

        return {"hotels": hotels}


# -- Climate (OpenWeather via RapidAPI) ----------------------------------------

@app.get("/api/climate")
async def climate(city: str = Query(...), lang: str = Query("EN")):
    if not city or not city.strip():
        raise HTTPException(status_code=400, detail="City is required")
    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="Missing RAPIDAPI_KEY")

    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "tripscout/1.0"}) as client:
        geo_res = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": city, "format": "jsonv2", "limit": 1},
        )
        if geo_res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Geocoding failed: {geo_res.text}")

        geo_data = geo_res.json()
        if not geo_data:
            raise HTTPException(status_code=404, detail=f"Could not find coordinates for: {city}")

        lat = geo_data[0].get("lat")
        lon = geo_data[0].get("lon")

        weather_res = await client.get(
            f"https://{WEATHER_HOST}/fivedaysforcast",
            params={"latitude": lat, "longitude": lon, "lang": lang},
            headers=rapid_headers(WEATHER_HOST),
        )
        if weather_res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Weather lookup failed: {weather_res.text}")

        data = weather_res.json()
        forecast_list = data.get("list", []) if isinstance(data, dict) else []
        first_item = forecast_list[0] if forecast_list else {}

        main = first_item.get("main", {})
        weather_list = first_item.get("weather", [])
        wind = first_item.get("wind", {})
        weather_text = weather_list[0].get("description", "") if weather_list else ""
        rain_obj = first_item.get("rain", {})
        rain_value = rain_obj.get("3h", "N/A") if isinstance(rain_obj, dict) else "N/A"

        return {
            "temp": f"{round(main.get('temp', 0))}°C" if main.get("temp") is not None else "N/A",
            "humidity": f"{main.get('humidity', 0)}%" if main.get("humidity") is not None else "N/A",
            "condition": weather_text or "N/A",
            "windSpeed": wind.get("speed", 0),
            "rain": rain_value,
            "advisory": "Carry an umbrella" if "rain" in weather_text.lower() else "Weather looks manageable",
        }


# -- Chat (Claude) -------------------------------------------------------------

@app.post("/api/chat")
async def chat_bot(data: dict):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Missing CLAUDE_API_KEY")

    client = Anthropic(api_key=CLAUDE_API_KEY)
    messages = data.get("messages", [])

    system_prompt = """You are a friendly travel planning assistant called TripScout.

STEP 1 - EXTRACT TRIP DETAILS from the user's message:
- origin (where they're flying from)
- destination (where they want to go)
- departure_date (YYYY-MM-DD format)
- return_date (YYYY-MM-DD format, optional)
- adults (number of travelers, default 1)
- budget (number in USD)
- preferences (what they enjoy)
- trip_type (oneway or roundtrip)

STEP 2 - ASK FOR MISSING INFO naturally. Don't ask everything at once.
Always ask for dates if not provided — flights and hotels CANNOT be searched without dates.

STEP 3 - WHEN YOU HAVE ENOUGH INFO (origin + destination + departure_date), include this block:
<TRIP_DATA>
{"origin": "BOM", "destination": "TYO", "departure_date": "2026-07-15", "return_date": "2026-07-22", "adults": 1, "budget": 2500, "preferences": "anime and ramen", "trip_type": "roundtrip", "ready": true}
</TRIP_DATA>

CRITICAL: origin and destination MUST be IATA airport codes. The Google Flights API only accepts IATA codes.
Always convert city names:
Mumbai=BOM, Delhi=DEL, Bangalore=BLR, Chennai=MAA, Kolkata=CCU,
Tokyo=TYO, London=LHR, Dubai=DXB, Paris=CDG, Bangkok=BKK,
Bali=DPS, New York=JFK, Singapore=SIN, Sydney=SYD, Rome=FCO

RULES:
- Set "ready": true only when you have origin, destination, and departure_date as IATA codes
- Always include <TRIP_DATA> tags in EVERY response with whatever info you have
- Be warm and conversational, keep responses under 80 words
- If dates are vague ("June"), pick a specific date and confirm
- Today's date is 2026-04-25"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        system=system_prompt,
        messages=messages,
    )

    reply = response.content[0].text

    trip_data = None
    clean_reply = reply
    if "<TRIP_DATA>" in reply and "</TRIP_DATA>" in reply:
        start = reply.index("<TRIP_DATA>") + len("<TRIP_DATA>")
        end = reply.index("</TRIP_DATA>")
        try:
            trip_data = json.loads(reply[start:end].strip())
        except Exception:
            pass
        clean_reply = (
            reply[: reply.index("<TRIP_DATA>")]
            + reply[reply.index("</TRIP_DATA>") + len("</TRIP_DATA>") :]
        ).strip()

    return {"reply": clean_reply, "trip_data": trip_data}
