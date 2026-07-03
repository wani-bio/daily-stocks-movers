# --- Ingestion side: EventBridge cron -> Lambda -> DynamoDB ---

# Zips the ingest handler so Lambda can deploy it; re-zips only when the source changes.
data "archive_file" "ingest" {
  type        = "zip"
  source_file = "${path.module}/../src/ingest/handler.py"
  output_path = "${path.module}/build/ingest.zip"
}

# Execution role the ingest Lambda assumes; grants nothing by itself.
resource "aws_iam_role" "ingest" {
  name = "${var.project}-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Least privilege for ingestion: write to the one table, read the one API-key
# secret, emit logs. No read access to the table, no other secrets.
resource "aws_iam_role_policy" "ingest" {
  name = "${var.project}-ingest-policy"
  role = aws_iam_role.ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.movers.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.massive.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# The ingest function: fetches open/close for the watchlist, computes the day's
# top absolute % mover, writes it to DynamoDB. 5-minute timeout because
# rate-limit backoff against the free stock API can legitimately take minutes.
resource "aws_lambda_function" "ingest" {
  function_name    = "${var.project}-ingest"
  role             = aws_iam_role.ingest.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.ingest.output_path
  source_code_hash = data.archive_file.ingest.output_base64sha256
  timeout          = 300 # rate-limit backoff can take a few minutes
  memory_size      = 128

  environment {
    variables = {
      MASSIVE_SECRET_ARN = aws_secretsmanager_secret.massive.arn
      MASSIVE_BASE_URL   = var.massive_base_url
      WATCHLIST          = var.watchlist
      DDB_TABLE          = aws_dynamodb_table.movers.name
    }
  }
}

# Daily schedule: fires after US market close (+ data-settle time) on trading days.
resource "aws_cloudwatch_event_rule" "daily" {
  name                = "${var.project}-daily-ingest"
  schedule_expression = var.ingest_schedule
}

# Points the schedule at the ingest Lambda.
resource "aws_cloudwatch_event_target" "ingest" {
  rule = aws_cloudwatch_event_rule.daily.name
  arn  = aws_lambda_function.ingest.arn
}

# Lets EventBridge (and only this rule) invoke the ingest Lambda.
resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily.arn
}
