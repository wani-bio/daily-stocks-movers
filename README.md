# Daily Stock Movers

A fully automated serverless pipeline on AWS that records, every trading day, which stock
from a fixed tech watchlist (AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA) moved the most —
highest absolute % change, up or down — and shows the 7-day history on a public dashboard.

**Live site:** http://stock-movers-site-393818036549.s3-website-us-east-1.amazonaws.com
**Live API:** https://5otcpnjj2f.execute-api.us-east-1.amazonaws.com/movers

![Movers dashboard — daily top mover stats, interactive 7-day chart, and history table](dashboard.png)

## Architecture

```
EventBridge (cron, 01:30 UTC Tue–Sat)
        │
        ▼
Ingest Lambda ──► Massive API (open/close per ticker)
        │           computes ((close − open) / open) × 100, keeps the biggest |move|
        ▼
    DynamoDB  (one row per trading day: date, ticker, percent_change, closing_price)
        ▲
        │  Scan, newest 7
 Retrieval Lambda ◄── API Gateway (HTTP API)  ◄── GET /movers
                                                     ▲
                                    React SPA on S3 ─┘
```

Ingestion (cron) and retrieval (API) are separate Lambdas with separate least-privilege
IAM roles: the ingest role can only `dynamodb:PutItem` on the table, the API role only
`dynamodb:Scan`.

## Repo layout

```
infra/       Terraform: DynamoDB, both Lambdas, EventBridge, API Gateway, S3 site
src/ingest/  Daily ingestion Lambda (+ test_handler.py logic test)
src/api/     GET /movers retrieval Lambda
frontend/    React (Vite) dashboard
```

## Deploy from scratch

Prerequisites: Terraform ≥ 1.5, AWS CLI configured (`aws configure`), Node ≥ 20,
and a free [Massive](https://massive.com) API key.

```bash
# 1. Infrastructure
cd infra
cp terraform.tfvars.example terraform.tfvars   # paste your Massive API key inside
terraform init
terraform apply                                 # creates everything; note the outputs

# 2. Frontend
cd ../frontend
npm ci
npm run build
aws s3 sync dist "s3://$(terraform -chdir=../infra output -raw site_bucket)"

# 3. Open the site
terraform -chdir=../infra output -raw site_url
```

The pipeline then runs itself: the cron fires nightly and appends one row per trading day.

To ingest a specific past date manually (e.g. to backfill):

```bash
aws lambda invoke --function-name stock-movers-ingest \
  --cli-binary-format raw-in-base64-out \
  --payload '{"date":"2026-06-25"}' out.json
```

## API

`GET /movers` → last 7 recorded days, newest first:

```json
{
  "movers": [
    { "date": "2026-06-30", "ticker": "TSLA", "percent_change": 3.5961,
      "closing_price": 420.6, "updated_at": "2026-07-02T00:10:18Z" }
  ],
  "count": 1
}
```

Responses carry `Cache-Control: max-age=300` (the data changes once a day) and the stage
is throttled to 5 req/s so the public endpoint can't exhaust free-tier usage.

## Error handling

- **Rate limits (HTTP 429)** — Massive's free tier allows 5 requests/min for a 6-ticker
  watchlist. The ingest Lambda retries with 30/60/90 s backoff, so even a fully spent
  minute budget recovers by the second retry.
- **Read timeouts / transient network errors** — caught and retried alongside 429s.
- **Non-trading days (404)** — skipped; nothing is stored, the run exits cleanly.
- **"Data not ready" (403)** — the free tier refuses same-day data until end of day; the
  Lambda detects this and steps back one weekday automatically.
- **DynamoDB failure at read time** — API returns 502 with a JSON error body instead of
  crashing.

## Security

- No secrets in the repo: the Massive key lives in `terraform.tfvars` (gitignored),
  which Terraform stores in **AWS Secrets Manager**; the Lambda receives only the
  secret's ARN and fetches the value at cold start.
- Least-privilege IAM per function (write-only vs read-only on the one table; the
  ingest role can additionally read exactly one secret).
- A **CloudWatch alarm** on ingest Lambda errors emails via SNS if a nightly run fails.
- CORS on the API is locked to the site origin (plus localhost dev ports), not `*`.
- The S3 bucket policy allows public `GetObject` only — required for static website
  hosting.

## CI/CD

On every push to `main`, GitHub Actions:
1. runs the ingest logic test,
2. validates the Terraform,
3. builds the frontend and syncs it to S3.

Infrastructure changes are applied locally with `terraform apply` (state is local for
this single-developer project — see trade-offs).

Required repo secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

## Trade-offs

- **Local Terraform state.** A remote S3 backend with locking is the production answer;
  for a one-week single-developer project, local state keeps the bootstrap simple. CI
  therefore validates IaC but doesn't apply it.
- **DynamoDB `Scan` in the API.** The table gains one small row per trading day, so a
  scan is effectively free; a GSI + Query would be warranted past ~1k rows.
- **HTTP-only site URL.** S3 website endpoints don't support HTTPS; CloudFront in front
  would add TLS and was skipped to stay within the brief's scope.
- **Sequential ticker fetches.** Parallelizing would hit the 5 req/min limit harder, not
  faster — the rate limit, not I/O, is the bottleneck.
