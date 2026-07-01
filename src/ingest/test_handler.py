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
print("ok")
