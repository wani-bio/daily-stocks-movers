"""GET /movers — return the last 7 recorded top movers from DynamoDB."""
import json
import os
from decimal import Decimal

import boto3

DDB_TABLE = os.environ["DDB_TABLE"]
table = boto3.resource("dynamodb").Table(DDB_TABLE)


def lambda_handler(event, context):
    try:
        # ponytail: full scan — table holds one small row per trading day,
        # switch to a Query on a GSI only if this ever grows past ~1k rows.
        items = table.scan()["Items"]
    except Exception as e:
        print(f"DynamoDB error: {e}")
        return _response(502, {"error": "storage unavailable"})

    movers = sorted(items, key=lambda i: i["date"], reverse=True)[:7]
    return _response(200, {"movers": movers, "count": len(movers)})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "max-age=300",  # data changes once a day
        },
        "body": json.dumps(body, default=lambda o: float(o) if isinstance(o, Decimal) else str(o)),
    }
