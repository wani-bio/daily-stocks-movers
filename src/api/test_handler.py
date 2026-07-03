"""Self-check for the /movers query-param parsing. Run: python src/api/test_handler.py"""
from handler import DEFAULT_DAYS, MAX_DAYS, _parse_days

assert _parse_days(None) == DEFAULT_DAYS
assert _parse_days({}) == DEFAULT_DAYS
assert _parse_days({"days": "14"}) == 14
assert _parse_days({"days": "1"}) == 1
assert _parse_days({"days": "0"}) == 1          # clamped up
assert _parse_days({"days": "999"}) == MAX_DAYS  # clamped down
assert _parse_days({"days": "-3"}) == 1
assert _parse_days({"days": "abc"}) is None
assert _parse_days({"days": ""}) is None

print("api handler tests passed")
