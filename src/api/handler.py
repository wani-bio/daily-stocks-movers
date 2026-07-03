"""GET /movers — return the last N (default 7, max 30) top movers from DynamoDB."""
import json
import os
from decimal import Decimal

DEFAULT_DAYS = 7
MAX_DAYS = 30


def _parse_days(qs):
    """?days=N clamped to [1, MAX_DAYS]; None if not an integer."""
    raw = (qs or {}).get("days", DEFAULT_DAYS)
    try:
        return max(1, min(MAX_DAYS, int(raw)))
    except (TypeError, ValueError):
        return None


def lambda_handler(event, context):
    import boto3  # ponytail: import here so the local test needs no boto3

    days = _parse_days(event.get("queryStringParameters"))
    if days is None:
        return _response(400, {"error": "days must be an integer"})

    table = boto3.resource("dynamodb").Table(os.environ["DDB_TABLE"])
    try:
        # ponytail: full scan — table holds one small row per trading day,
        # switch to a Query on a GSI only if this ever grows past ~1k rows.
        items = table.scan()["Items"]
    except Exception as e:
        print(f"DynamoDB error: {e}")
        return _response(502, {"error": "storage unavailable"})

    movers = sorted(items, key=lambda i: i["date"], reverse=True)[:days]
    return _response(200, {"movers": movers, "count": len(movers), "days": days})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "max-age=300",  # data changes once a day
        },
        "body": json.dumps(body, default=lambda o: float(o) if isinstance(o, Decimal) else str(o)),
    }
