"""Retrieval API.

GET  /movers — last N (default 7, max 30) top movers from DynamoDB.
POST /chat   — Gemini-backed Q&A about one recorded trading day.
"""
import json
import os
import re
import urllib.error
import urllib.request
from decimal import Decimal

DEFAULT_DAYS = 7
MAX_DAYS = 30

MAX_MESSAGES = 12        # per conversation sent to /chat
MAX_MESSAGE_CHARS = 500  # user input; model replies in history may be longer
MAX_REPLY_CHARS = 4000

_gemini_key = None  # cached across warm invocations


def _parse_days(qs):
    """?days=N clamped to [1, MAX_DAYS]; None if not an integer."""
    raw = (qs or {}).get("days", DEFAULT_DAYS)
    try:
        return max(1, min(MAX_DAYS, int(raw)))
    except (TypeError, ValueError):
        return None


def _parse_chat(body):
    """Validate a /chat body. Returns (date, messages) or (None, error_string)."""
    try:
        data = json.loads(body or "")
    except (TypeError, ValueError):
        return None, "body must be JSON"
    day = data.get("date")
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return None, "date must be YYYY-MM-DD"
    msgs = data.get("messages")
    if not isinstance(msgs, list) or not msgs or len(msgs) > MAX_MESSAGES:
        return None, f"messages must be a list of 1-{MAX_MESSAGES} items"
    for m in msgs:
        if not isinstance(m, dict) or m.get("role") not in ("user", "model") \
                or not isinstance(m.get("text"), str) or not m["text"].strip():
            return None, "each message needs role user|model and non-empty text"
        limit = MAX_MESSAGE_CHARS if m["role"] == "user" else MAX_REPLY_CHARS
        if len(m["text"]) > limit:
            return None, f"{m['role']} message too long (max {limit} chars)"
    if msgs[-1]["role"] != "user":
        return None, "last message must be from the user"
    return day, msgs


def _system_prompt(row):
    facts = [
        f"Date: {row['date']}",
        f"Top mover of the watchlist (AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA): {row['ticker']}",
        f"Open-to-close change: {row['percent_change']}%",
        f"Closing price: ${row['closing_price']}",
    ]
    if row.get("headline"):
        facts.append(f"Related headline ({row.get('news_source', 'unknown source')}): {row['headline']}")
    if row.get("news_reason"):
        facts.append(f"Article's take on {row['ticker']}: {row['news_reason']}")
    if row.get("sentiment"):
        facts.append(f"Article sentiment for {row['ticker']}: {row['sentiment']}")
    if row.get("all_movers"):
        moves = sorted(row["all_movers"].items(),
                       key=lambda kv: float(kv[1]["percent_change"]), reverse=True)
        facts.append("Every watchlist move that day (open-to-close): "
                     + ", ".join(f"{t} {v['percent_change']}%" for t, v in moves))
    return (
        "You are the assistant on a small stock dashboard that records, each trading day, "
        "which watchlist stock moved the most. The user is asking about one recorded day.\n\n"
        "Recorded facts:\n- " + "\n- ".join(facts) + "\n\n"
        "Ground your answers in these facts plus general market knowledge. Be clear about "
        "what is fact versus interpretation; a same-day headline is context, not proven cause. "
        "If you don't know, say so. Keep answers under 150 words. Do not give financial advice."
    )


def _ask_gemini(row, messages):
    global _gemini_key
    if _gemini_key is None:
        import boto3
        _gemini_key = boto3.client("secretsmanager").get_secret_value(
            SecretId=os.environ["GEMINI_SECRET_ARN"])["SecretString"]
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "system_instruction": {"parts": [{"text": _system_prompt(row)}]},
        "contents": [{"role": m["role"], "parts": [{"text": m["text"]}]} for m in messages],
        "generationConfig": {
            "maxOutputTokens": 1024,
            "temperature": 0.4,
            # thinking tokens count toward the cap and truncate the visible reply
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": _gemini_key},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _chat(event, table):
    day, msgs = _parse_chat(event.get("body"))
    if day is None:
        return _response(400, {"error": msgs})

    row = table.get_item(Key={"date": day}).get("Item")
    if not row:
        return _response(404, {"error": f"no recorded data for {day}"})

    try:
        reply = _ask_gemini(row, msgs)
    except Exception as e:
        print(f"Gemini error: {e}")
        return _response(502, {"error": "AI unavailable, try again shortly"})
    return _response(200, {"reply": reply}, cache=False)


def lambda_handler(event, context):
    import boto3  # ponytail: import here so the local test needs no boto3

    table = boto3.resource("dynamodb").Table(os.environ["DDB_TABLE"])

    if event.get("routeKey") == "POST /chat":
        return _chat(event, table)

    days = _parse_days(event.get("queryStringParameters"))
    if days is None:
        return _response(400, {"error": "days must be an integer"})

    try:
        # ponytail: full scan — table holds one small row per trading day,
        # switch to a Query on a GSI only if this ever grows past ~1k rows.
        items = table.scan()["Items"]
    except Exception as e:
        print(f"DynamoDB error: {e}")
        return _response(502, {"error": "storage unavailable"})

    movers = sorted(items, key=lambda i: i["date"], reverse=True)[:days]
    return _response(200, {"movers": movers, "count": len(movers), "days": days})


def _response(status, body, cache=True):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            # data changes once a day; chat replies must never be cached
            "Cache-Control": "max-age=300" if cache else "no-store",
        },
        "body": json.dumps(body, default=lambda o: float(o) if isinstance(o, Decimal) else str(o)),
    }
