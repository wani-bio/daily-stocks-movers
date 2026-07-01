"""Daily ingestion: find the watchlist stock with the biggest % move and store it.

Runs on an EventBridge cron in Lambda; run locally with --dry-run to test
against the real Massive API without touching DynamoDB.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from decimal import Decimal

MASSIVE_API_KEY = os.environ["MASSIVE_API_KEY"]
MASSIVE_BASE_URL = os.environ.get("MASSIVE_BASE_URL", "https://api.massive.com")
WATCHLIST = os.environ.get("WATCHLIST", "AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA").split(",")
DDB_TABLE = os.environ.get("DDB_TABLE", "stocks-movers")

MAX_RETRIES = 3


class DataNotReady(Exception):
    """Free tier returns 403 until the trading day has ended (US market time)."""


def fetch_open_close(ticker: str, day: str) -> dict | None:
    """Fetch daily open/close for one ticker. Returns None if no data (e.g. holiday).

    Retries with backoff on rate limits (429) and server errors — the free
    tier allows only 5 requests/min.
    """
    url = f"{MASSIVE_BASE_URL}/v1/open-close/{ticker}/{day}?apiKey={MASSIVE_API_KEY}"
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read())
            if data.get("status") == "OK":
                return data
            return None  # e.g. status NOT_FOUND on non-trading days
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 403:
                raise DataNotReady(day)
            if e.code == 429 or e.code >= 500:
                # ponytail: fixed backoff, good enough for 6 tickers under a 5/min limit
                wait = 15 * (attempt + 1)
                print(f"{ticker}: HTTP {e.code}, retry in {wait}s")
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError as e:
            print(f"{ticker}: network error {e}, retry {attempt + 1}")
            time.sleep(5)
    raise RuntimeError(f"Failed to fetch {ticker} after {MAX_RETRIES} attempts")


def find_top_mover(day: str) -> dict | None:
    """Return the watchlist stock with the highest absolute % change for `day`."""
    top = None
    for ticker in WATCHLIST:
        data = fetch_open_close(ticker.strip(), day)
        if not data or not data.get("open"):
            print(f"{ticker}: no data for {day}")
            continue
        pct = (data["close"] - data["open"]) / data["open"] * 100
        print(f"{ticker}: open={data['open']} close={data['close']} pct={pct:+.2f}%")
        if top is None or abs(pct) > abs(top["percent_change"]):
            top = {
                "date": day,
                "ticker": ticker,
                "percent_change": round(pct, 4),
                "closing_price": data["close"],
            }
    return top


def resolve_top_mover(day_str: str) -> dict | None:
    """find_top_mover, stepping back one weekday if the market day isn't closed yet."""
    try:
        return find_top_mover(day_str)
    except DataNotReady:
        day = date.fromisoformat(day_str) - timedelta(days=1)
        while day.weekday() >= 5:
            day -= timedelta(days=1)
        print(f"Data for {day_str} not ready, falling back to {day.isoformat()}")
        return find_top_mover(day.isoformat())


def store_result(item: dict) -> None:
    import boto3  # ponytail: import here so local --dry-run needs no boto3

    table = boto3.resource("dynamodb").Table(DDB_TABLE)
    table.put_item(Item={
        "date": item["date"],
        "ticker": item["ticker"],
        "percent_change": Decimal(str(item["percent_change"])),
        "closing_price": Decimal(str(item["closing_price"])),
        "updated_at": datetime.utcnow().isoformat() + "Z",
    })


def lambda_handler(event, context):
    # Free tier data is end-of-day: process the most recent weekday before today.
    day = date.today() - timedelta(days=1)
    while day.weekday() >= 5:  # Sat/Sun
        day -= timedelta(days=1)
    day_str = (event or {}).get("date") or day.isoformat()

    top = resolve_top_mover(day_str)
    if top is None:
        print(f"No trading data for {day_str} (holiday?) — nothing stored.")
        return {"statusCode": 200, "body": f"no data for {day_str}"}

    store_result(top)
    print(f"Stored top mover: {top}")
    return {"statusCode": 200, "body": json.dumps(top)}


if __name__ == "__main__":
    import sys
    day_arg = sys.argv[2] if len(sys.argv) > 2 else None
    if "--dry-run" in sys.argv:
        d = day_arg or (date.today() - timedelta(days=1)).isoformat()
        print(f"Dry run for {d}:")
        print("TOP MOVER:", resolve_top_mover(d))
    else:
        print(lambda_handler({"date": day_arg} if day_arg else {}, None))
