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

def _api_key() -> str:
    """Secrets Manager in Lambda; plain env var for local runs/tests."""
    arn = os.environ.get("MASSIVE_SECRET_ARN")
    if not arn:
        return os.environ["MASSIVE_API_KEY"]
    import boto3
    return boto3.client("secretsmanager").get_secret_value(SecretId=arn)["SecretString"]


MASSIVE_API_KEY = _api_key()  # fetched once per cold start
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
                # 30/60/90s: a fully spent 5-req/min budget always recovers by attempt 2
                wait = 30 * (attempt + 1)
                print(f"{ticker}: HTTP {e.code}, retry in {wait}s")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"{ticker}: network error {e}, retry {attempt + 1}")
            time.sleep(5)
    raise RuntimeError(f"Failed to fetch {ticker} after {MAX_RETRIES} attempts")


def _extract_news(payload: dict, ticker: str) -> dict | None:
    """Pull headline/url/source/sentiment/reasoning for `ticker` from /v2/reference/news.

    Prefers the first article whose insights actually analyze `ticker` (those carry a
    sentiment_reasoning sentence explaining the move); falls back to the newest article.
    """
    results = payload.get("results") or []

    def insight_for(art):
        return next((i for i in art.get("insights") or [] if i.get("ticker") == ticker), None)

    art = next((a for a in results if insight_for(a) and (insight_for(a).get("sentiment_reasoning"))), None) \
        or (results[0] if results else None)
    if not art or not art.get("title"):
        return None

    news = {
        "headline": art.get("title"),
        "news_url": art.get("article_url"),
        "news_source": (art.get("publisher") or {}).get("name"),
    }
    ins = insight_for(art)
    if ins:
        news["sentiment"] = ins.get("sentiment")
        if ins.get("sentiment_reasoning"):
            news["news_reason"] = ins["sentiment_reasoning"]
    return news


def fetch_news(ticker: str, day: str) -> dict | None:
    """Most recent headline for `ticker` published on `day`. Best effort:
    returns None on any failure — a missing headline must never sink the run."""
    nxt = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    url = (f"{MASSIVE_BASE_URL}/v2/reference/news?ticker={ticker}"
           f"&published_utc.gte={day}&published_utc.lt={nxt}"
           f"&limit=10&sort=published_utc&order=descending&apiKey={MASSIVE_API_KEY}")
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                return _extract_news(json.loads(resp.read()), ticker)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = 30 * (attempt + 1)
                print(f"news {ticker}: HTTP {e.code}, retry in {wait}s")
                time.sleep(wait)
                continue
            print(f"news {ticker}: HTTP {e.code}, skipping headline")
            return None
        except Exception as e:  # ponytail: news is decoration, never fail ingest for it
            print(f"news {ticker}: {e}, skipping headline")
            return None
    print(f"news {ticker}: rate-limited out, skipping headline")
    return None


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
    row = {
        "date": item["date"],
        "ticker": item["ticker"],
        "percent_change": Decimal(str(item["percent_change"])),
        "closing_price": Decimal(str(item["closing_price"])),
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    for k in ("headline", "news_url", "news_source", "sentiment", "news_reason"):
        if item.get(k):
            row[k] = item[k]
    table.put_item(Item=row)


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

    news = fetch_news(top["ticker"], top["date"])
    if news:
        top.update(news)

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
