from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
import os
from pydantic import BaseModel, field_validator, model_validator
from typing import Literal, Optional
from datetime import date
from anthropic import Anthropic
import json

load_dotenv()

app = FastAPI(title="Travel Agent Orchestrator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
DUFFEL_API_KEY = os.getenv("DUFFEL_API_KEY", "")
SKY_HOST = os.getenv("SKY_HOST", "google-flights2.p.rapidapi.com")
BOOKING_HOST = os.getenv("BOOKING_HOST", "booking-com15.p.rapidapi.com")
WEATHER_HOST = os.getenv("WEATHER_HOST", "open-weather13.p.rapidapi.com")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")


def rapid_headers(host: str) -> dict:
    return {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": host,
        "Content-Type": "application/json",
    }


def duffel_headers() -> dict:
    return {
        "Authorization": f"Bearer {DUFFEL_API_KEY}",
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def mins_to_text(minutes: int) -> str:
    if not minutes:
        return ""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h {mins}m" if hours else f"{mins}m"


def debug_log(label: str, url: str, params: dict | None = None):
    print("\n===== API DEBUG =====")
    print("LABEL:", label)
    print("URL:", url)
    print("PARAMS:", params or {})
    print("=====================\n")


def map_travel_class(cabin_class: str) -> str:
    value = (cabin_class or "").strip().lower()
    mapping = {
        "economy": "ECONOMY",
        "premium economy": "PREMIUM_ECONOMY",
        "premium_economy": "PREMIUM_ECONOMY",
        "business": "BUSINESS",
        "first": "FIRST",
    }
    return mapping.get(value, "ECONOMY")


class TripValidation(BaseModel):
    origin: str
    destination: str
    departure_date: date
    return_date: Optional[date] = None
    adults: int
    trip_type: Literal["oneway", "roundtrip"]
    stops: Literal["nonstop", "1 stop", "any"]
    budget: float

    @field_validator("origin", "destination")
    @classmethod
    def validate_city(cls, value: str):
        if not value or not value.strip():
            raise ValueError("City is required")
        cleaned = value.replace(" ", "").replace("-", "")
        if not cleaned.isalpha():
            raise ValueError("City must contain letters only")
        return value.strip()

    @field_validator("adults")
    @classmethod
    def validate_adults(cls, value: int):
        if value < 1:
            raise ValueError("At least 1 traveler required")
        if value > 9:
            raise ValueError("Maximum 9 travelers allowed")
        return value

    @field_validator("budget")
    @classmethod
    def validate_budget(cls, value: float):
        if value <= 0:
            raise ValueError("Budget must be greater than 0")
        return value

    @field_validator("departure_date")
    @classmethod
    def validate_departure_date(cls, value: date):
        if value < date.today():
            raise ValueError("Departure date cannot be in the past")
        return value

    @model_validator(mode="after")
    def validate_trip(self):
        if self.origin.strip().lower() == self.destination.strip().lower():
            raise ValueError("Origin and destination cannot be the same")

        if self.trip_type == "roundtrip":
            if not self.return_date:
                raise ValueError("Return date is required for roundtrip")
            if self.return_date <= self.departure_date:
                raise ValueError("Return date must be after departure date")

        return self


@app.get("/health")
def health():
    return {
        "status": "ok",
        "rapidapi_key_loaded": bool(RAPIDAPI_KEY),
        "duffel_key_loaded": bool(DUFFEL_API_KEY),
        "sky_host": SKY_HOST,
        "booking_host": BOOKING_HOST,
        "weather_host": WEATHER_HOST,
    }
@app.get("/api/airport-suggestions")
async def airport_suggestions(q: str = Query(..., min_length=2)):
    if not DUFFEL_API_KEY:
        raise HTTPException(status_code=500, detail="Missing DUFFEL_API_KEY")

    query = q.strip()
    if len(query) < 2:
        return {"suggestions": []}

    async with httpx.AsyncClient(timeout=20) as client:
        url = "https://api.duffel.com/places/suggestions"
        params = {"query": query}

        debug_log("DUFFEL AIRPORT SUGGESTIONS", url, params)

        res = await client.get(
            url,
            params=params,
            headers=duffel_headers(),
        )

        if res.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Airport suggestions lookup failed: {res.text}",
            )

        raw = res.json()
        data = raw.get("data", [])

        suggestions = []
        for item in data[:8]:
            if not isinstance(item, dict):
                continue

            iata = item.get("iata_code", "")
            name = item.get("name", "Unknown")
            city_name = item.get("city_name", "")
            item_type = item.get("type", "")

            label = f"{name} ({iata})" if iata else name
            subtitle = f"{city_name}" if city_name and city_name != name else ""
            if item_type:
                subtitle = f"{subtitle} · {item_type}" if subtitle else item_type

            suggestions.append({
                "label": label,
                "title": name,
                "subtitle": subtitle,
                "city": city_name or name,
                "airport_code": iata,
                "id": item.get("id", iata or name),
                "raw": item,
            })

        return {"suggestions": suggestions}

@app.get("/api/flights")
async def search_flights(
    origin: str = Query(...),
    destination: str = Query(...),
    departure_date: str = Query(...),
    return_date: str | None = Query(None),
    adults: int = Query(1),
    cabin_class: str = Query("economy"),
):
    trip_type = "roundtrip" if return_date else "oneway"

    TripValidation(
        origin=origin,
        destination=destination,
        departure_date=departure_date,
        return_date=return_date,
        adults=adults,
        trip_type=trip_type,
        stops="any",
        budget=1000,
    )

    if not DUFFEL_API_KEY:
        raise HTTPException(status_code=500, detail="Missing DUFFEL_API_KEY")

    # Build slices for Duffel
    # Origin/destination can be IATA codes (DEL) or city names
    # Duffel accepts IATA codes directly
    origin_code = origin.strip()
    dest_code = destination.strip()

    # If user passed a full label like "Delhi (DEL)", extract the code
    if "(" in origin_code and ")" in origin_code:
        origin_code = origin_code.split("(")[-1].replace(")", "").strip()
    if "(" in dest_code and ")" in dest_code:
        dest_code = dest_code.split("(")[-1].replace(")", "").strip()

    slices = [
        {
            "origin": origin_code,
            "destination": dest_code,
            "departure_date": departure_date,
        }
    ]

    if return_date:
        slices.append({
            "origin": dest_code,
            "destination": origin_code,
            "departure_date": return_date,
        })

    # Map cabin class
    cabin_map = {
        "economy": "economy",
        "premium economy": "premium_economy",
        "premium_economy": "premium_economy",
        "business": "business",
        "first": "first",
    }
    duffel_cabin = cabin_map.get(cabin_class.lower().strip(), "economy")

    # Build passengers
    passengers = [{"type": "adult"} for _ in range(adults)]

    payload = {
        "data": {
            "slices": slices,
            "passengers": passengers,
            "cabin_class": duffel_cabin,
        }
    }

    debug_log("DUFFEL FLIGHT SEARCH", "https://api.duffel.com/air/offer_requests", payload)

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.duffel.com/air/offer_requests",
            json=payload,
            headers=duffel_headers(),
            params={"return_offers": "true"},
        )

        if res.status_code not in (200, 201):
            error_detail = res.text
            try:
                err_json = res.json()
                errors = err_json.get("errors", [])
                if errors:
                    error_detail = errors[0].get("message", res.text)
            except Exception:
                pass
            raise HTTPException(
                status_code=500,
                detail=f"Duffel flight search failed: {error_detail}",
            )

        raw = res.json()
        offers = raw.get("data", {}).get("offers", [])

        print(f"DUFFEL OFFERS COUNT: {len(offers)}")

        flights = []
        for offer in offers[:10]:
            if not isinstance(offer, dict):
                continue

            slices_data = offer.get("slices", [])
            first_slice = slices_data[0] if slices_data else {}
            segments = first_slice.get("segments", [])
            first_seg = segments[0] if segments else {}
            last_seg = segments[-1] if segments else {}

            # Airline info
            owner = offer.get("owner", {})
            airline_name = owner.get("name", "Unknown Airline")

            # Departure and arrival times
            dep_time = first_seg.get("departing_at", "")
            arr_time = last_seg.get("arriving_at", "")

            # Duration
            duration_str = first_slice.get("duration", "")
            duration_text = ""
            if duration_str:
                # Duffel returns ISO 8601 duration like "PT7H30M"
                dur = duration_str.replace("PT", "")
                hours = 0
                mins = 0
                if "H" in dur:
                    parts = dur.split("H")
                    hours = int(parts[0])
                    dur = parts[1]
                if "M" in dur:
                    mins = int(dur.replace("M", ""))
                duration_text = f"{hours}h {mins}m" if hours else f"{mins}m"

            # Stops
            stops = len(segments) - 1

            # Price
            total_amount = float(offer.get("total_amount", 0))
            total_currency = offer.get("total_currency", "USD")

            flights.append({
                "airline": airline_name,
                "dep": dep_time,
                "arr": arr_time,
                "stops": stops,
                "duration": 0,
                "durationText": duration_text,
                "price": total_amount,
                "formattedPrice": f"{total_currency} {total_amount:.2f}",
                "origin": origin,
                "destination": destination,
                "offer_id": offer.get("id", ""),
                "raw": offer,
            })

        print("FINAL RETURN FLIGHTS COUNT:", len(flights))
        return {
            "flights": flights,
            "source": "duffel",
            "provider_name": "Duffel (300+ airlines)",
            "route": {
                "origin": origin,
                "destination": destination,
            },
        }
        

@app.get("/api/hotels")
async def search_hotels(
    city: str = Query(...),
    checkin: str = Query(...),
    checkout: str = Query(...),
    adults: int = Query(1),
    room_qty: int = Query(1),
):
    if not city or not city.strip():
        raise HTTPException(status_code=400, detail="City is required")
    if not checkin or not checkout:
        raise HTTPException(status_code=400, detail="Check-in and checkout dates are required")
    if adults < 1:
        raise HTTPException(status_code=400, detail="At least 1 adult is required")
    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="Missing RAPIDAPI_KEY")

    async with httpx.AsyncClient(timeout=40) as client:
        destination_url = f"https://{BOOKING_HOST}/api/v1/hotels/searchDestination"
        destination_params = {"query": city}
        debug_log("HOTEL DESTINATION SEARCH", destination_url, destination_params)

        dest_res = await client.get(
            destination_url,
            params=destination_params,
            headers=rapid_headers(BOOKING_HOST),
        )

        if dest_res.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Destination search failed: {dest_res.text}",
            )

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
            "arrival_date": checkin,
            "departure_date": checkout,
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
            hotel_url,
            params=hotel_params,
            headers=rapid_headers(BOOKING_HOST),
        )

        if hotel_res.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Hotel search failed: {hotel_res.text}",
            )

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
                "currency": gross.get("currency", "INR"),
                "area": prop.get("wishlistName", city),
                "amenities": [],
                "raw": item,
            })

        return {"hotels": hotels}


@app.get("/api/climate")
async def climate(city: str = Query(...), lang: str = Query("EN")):
    if not city or not city.strip():
        raise HTTPException(status_code=400, detail="City is required")
    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="Missing RAPIDAPI_KEY")

    async with httpx.AsyncClient(
        timeout=30,
        headers={"User-Agent": "travel-agent-orchestrator/1.0"}
    ) as client:
        geo_url = "https://nominatim.openstreetmap.org/search"
        geo_params = {
            "q": city,
            "format": "jsonv2",
            "limit": 1,
        }

        print("\n===== API DEBUG =====")
        print("LABEL: WEATHER GEOCODING")
        print("URL:", geo_url)
        print("PARAMS:", geo_params)
        print("=====================\n")

        geo_res = await client.get(geo_url, params=geo_params)
        if geo_res.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Weather geocoding failed: {geo_res.text}",
            )

        geo_data = geo_res.json()
        if not geo_data:
            raise HTTPException(
                status_code=404,
                detail=f"Could not find coordinates for city: {city}",
            )

        lat = geo_data[0].get("lat")
        lon = geo_data[0].get("lon")

        if lat is None or lon is None:
            raise HTTPException(
                status_code=500,
                detail=f"Coordinates missing for city: {city}",
            )

        weather_url = f"https://{WEATHER_HOST}/fivedaysforcast"
        weather_params = {
            "latitude": lat,
            "longitude": lon,
            "lang": lang,
        }

        print("\n===== API DEBUG =====")
        print("LABEL: WEATHER FORECAST")
        print("URL:", weather_url)
        print("PARAMS:", weather_params)
        print("=====================\n")

        weather_res = await client.get(
            weather_url,
            params=weather_params,
            headers=rapid_headers(WEATHER_HOST),
        )

        if weather_res.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Weather lookup failed: {weather_res.text}",
            )

        data = weather_res.json()

        forecast_list = data.get("list", []) if isinstance(data, dict) else []
        first_item = forecast_list[0] if forecast_list else {}

        main = first_item.get("main", {})
        weather_list = first_item.get("weather", [])
        wind = first_item.get("wind", {})
        weather_text = weather_list[0].get("description", "") if weather_list else ""

        rain_value = "N/A"
        rain_obj = first_item.get("rain", {})
        if isinstance(rain_obj, dict):
            rain_value = rain_obj.get("3h", "N/A")

        return {
            "temp": f"{round(main.get('temp', 0))}°C" if main.get("temp") is not None else "N/A",
            "humidity": f"{main.get('humidity', 0)}%" if main.get("humidity") is not None else "N/A",
            "condition": weather_text or "N/A",
            "windSpeed": wind.get("speed", 0),
            "rain": rain_value,
            "advisory": "Carry umbrella" if "rain" in weather_text.lower() else "Weather looks manageable",
            "raw": data,
        }

@app.post("/api/plan")
async def ai_plan(data: dict):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Missing CLAUDE_API_KEY")

    client = Anthropic(api_key=CLAUDE_API_KEY)

    prompt = f"""Plan a trip from {data.get('origin', '')} to {data.get('destination', '')}.
Dates: {data.get('departure_date', '')} to {data.get('return_date', '')}.
Budget: ${data.get('budget', 1000)} USD for {data.get('adults', 1)} travelers.
Interests: {data.get('preferences', 'general sightseeing')}.

Return ONLY valid JSON with no markdown formatting, no backticks, no explanation. Just pure JSON:
{{
  "budget": [
    {{"label": "category name", "amount": number, "note": "why this amount"}}
  ],
  "itinerary": [
    {{"day": 1, "title": "day title", "activities": ["specific activity 1", "specific activity 2", "specific activity 3", "specific activity 4"]}}
  ],
  "tips": ["specific helpful tip 1", "specific helpful tip 2", "specific helpful tip 3"]
}}

Make every recommendation specific - real restaurant names, real attraction names, real prices. Personalize based on their interests."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text

    try:
        plan = json.loads(text)
    except Exception:
        clean = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        try:
            plan = json.loads(clean)
        except Exception:
            plan = {"raw_response": text, "parse_error": True}

    return {"plan": plan}


@app.post("/api/chat")
async def chat_bot(data: dict):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Missing CLAUDE_API_KEY")

    client = Anthropic(api_key=CLAUDE_API_KEY)
    messages = data.get("messages", [])
    trip_context = data.get("trip_context", {})

    system_prompt = """You are a friendly travel planning assistant bot. Your job is to help users plan trips through natural conversation.

STEP 1 - EXTRACT TRIP DETAILS:
When the user describes a trip, extract these details from their message:
- origin (where they're flying from)
- destination (where they want to go)
- departure_date (YYYY-MM-DD format)
- return_date (YYYY-MM-DD format)  
- adults (number of travelers)
- budget (number in USD)
- preferences (what they enjoy)
- trip_type (oneway or roundtrip)

STEP 2 - ASK FOR MISSING INFO:
If any required field is missing (origin, destination, dates), ask for it naturally in conversation. Don't ask for everything at once - be conversational.

STEP 3 - WHEN YOU HAVE ENOUGH INFO:
Once you have at least origin, destination, and departure_date, include a JSON block in your response wrapped in <TRIP_DATA> tags like this:

<TRIP_DATA>
{"origin": "Delhi", "destination": "Paris", "departure_date": "2026-07-15", "return_date": "2026-07-20", "adults": 2, "budget": 3000, "preferences": "art and food", "trip_type": "roundtrip", "ready": true}
</TRIP_DATA>

Set "ready": true only when you have origin, destination, and at least departure_date.
Set "ready": false if you're still collecting info.

Always include <TRIP_DATA> tags in EVERY response with whatever info you've collected so far.

RULES:
- Be warm, friendly, and conversational - not robotic
- Use short responses, not essays
- If they give vague dates like "next month" or "december", pick reasonable specific dates and confirm with them
- If they don't mention budget, suggest a reasonable one based on the destination
- If they don't mention number of travelers, assume 1
- Today's date is 2026-04-10
- Keep responses under 100 words unless giving a full plan
- After the search results come back, help them understand the options and make recommendations based on their preferences"""

    if trip_context:
        system_prompt += f"\n\nPreviously collected trip info: {json.dumps(trip_context)}"

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        system=system_prompt,
        messages=messages,
    )

    reply = response.content[0].text

    # Extract trip data from response
    trip_data = None
    clean_reply = reply
    if "<TRIP_DATA>" in reply and "</TRIP_DATA>" in reply:
        start = reply.index("<TRIP_DATA>") + len("<TRIP_DATA>")
        end = reply.index("</TRIP_DATA>")
        try:
            trip_data = json.loads(reply[start:end].strip())
        except Exception:
            pass
        clean_reply = reply[:reply.index("<TRIP_DATA>")] + reply[reply.index("</TRIP_DATA>") + len("</TRIP_DATA>"):]
        clean_reply = clean_reply.strip()

    return {
        "reply": clean_reply,
        "trip_data": trip_data,
    }
