"""Self-check for the /movers query-param parsing. Run: python src/api/test_handler.py"""
import json

from handler import DEFAULT_DAYS, MAX_DAYS, _parse_chat, _parse_days, _system_prompt

assert _parse_days(None) == DEFAULT_DAYS
assert _parse_days({}) == DEFAULT_DAYS
assert _parse_days({"days": "14"}) == 14
assert _parse_days({"days": "1"}) == 1
assert _parse_days({"days": "0"}) == 1          # clamped up
assert _parse_days({"days": "999"}) == MAX_DAYS  # clamped down
assert _parse_days({"days": "-3"}) == 1
assert _parse_days({"days": "abc"}) is None
assert _parse_days({"days": ""}) is None

# /chat body validation
ok_body = json.dumps({"date": "2026-07-02", "messages": [{"role": "user", "text": "why did it drop?"}]})
day, msgs = _parse_chat(ok_body)
assert day == "2026-07-02" and msgs[0]["text"] == "why did it drop?"

# model replies in history may exceed the user cap
long_history = json.dumps({"date": "2026-07-02", "messages": [
    {"role": "user", "text": "why?"},
    {"role": "model", "text": "m" * 2000},
    {"role": "user", "text": "and then?"},
]})
day, msgs = _parse_chat(long_history)
assert day == "2026-07-02" and len(msgs) == 3

for bad in [
    None,                                                            # not JSON
    json.dumps({"date": "bad", "messages": [{"role": "user", "text": "x"}]}),
    json.dumps({"date": "2026-07-02", "messages": []}),              # empty
    json.dumps({"date": "2026-07-02", "messages": [{"role": "user", "text": "x" * 501}]}),
    json.dumps({"date": "2026-07-02", "messages": [{"role": "model", "text": "hi"}]}),  # last not user
    json.dumps({"date": "2026-07-02", "messages": [{"role": "hacker", "text": "x"}]}),
]:
    d, err = _parse_chat(bad)
    assert d is None and isinstance(err, str), bad

# system prompt includes the facts it has, skips the ones it doesn't
p = _system_prompt({"date": "2026-07-02", "ticker": "TSLA", "percent_change": -8.07,
                    "closing_price": 393.45, "news_reason": "rotation away from Tesla",
                    "all_movers": {"TSLA": {"percent_change": -8.07, "closing_price": 393.45},
                                   "AAPL": {"percent_change": 4.93, "closing_price": 308.63}}})
assert "TSLA" in p and "rotation away from Tesla" in p
assert "AAPL 4.93%" in p, p  # comparative grounding present, sorted best-first
assert p.index("AAPL 4.93%") < p.index("TSLA -8.07%")

print("api handler tests passed")
