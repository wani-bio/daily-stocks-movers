"""Minimal check for the mover-picking math: python src/ingest/test_handler.py"""
import os

os.environ.setdefault("MASSIVE_API_KEY", "test")
import handler

FAKE = {
    "AAPL": {"status": "OK", "open": 100.0, "close": 102.0},   # +2%
    "MSFT": {"status": "OK", "open": 100.0, "close": 95.0},    # -5%  <- biggest abs move
    "GOOGL": None,                                             # holiday/no data
}

handler.WATCHLIST = list(FAKE)
handler.fetch_open_close = lambda t, d: FAKE[t]

top = handler.find_top_mover("2026-01-02")
assert top["ticker"] == "MSFT", top
assert top["percent_change"] == -5.0, top
assert top["closing_price"] == 95.0, top

NEWS_PAYLOAD = {"results": [
    {   # newest, but only mentions MSFT in passing — no MSFT insight
        "title": "Market recap: everything moved",
        "article_url": "https://example.com/recap",
        "publisher": {"name": "Recapper"},
        "insights": [{"ticker": "AAPL", "sentiment": "neutral", "sentiment_reasoning": "flat day"}],
    },
    {   # older, but actually analyzes MSFT — should win
        "title": "MSFT slides on cloud outage",
        "article_url": "https://example.com/a",
        "publisher": {"name": "Newswire"},
        "insights": [{"ticker": "MSFT", "sentiment": "negative",
                      "sentiment_reasoning": "Outage expected to dent quarterly cloud revenue."}],
    },
]}
news = handler._extract_news(NEWS_PAYLOAD, "MSFT")
assert news["headline"] == "MSFT slides on cloud outage", news
assert news["sentiment"] == "negative", news
assert news["news_reason"] == "Outage expected to dent quarterly cloud revenue.", news

# no ticker-specific article -> falls back to the newest one, without reasoning
fallback = handler._extract_news(NEWS_PAYLOAD, "TSLA")
assert fallback["headline"] == "Market recap: everything moved", fallback
assert "news_reason" not in fallback, fallback

assert handler._extract_news({"results": []}, "MSFT") is None
assert handler._extract_news({}, "MSFT") is None
print("ok")
