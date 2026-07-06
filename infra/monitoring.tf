# --- Secrets & alerting ---

# Holds the Massive API key so it never appears in Lambda env vars or state
# output; the ingest Lambda fetches it at cold start.
resource "aws_secretsmanager_secret" "massive" {
  name                    = "${var.project}-massive-api-key"
  recovery_window_in_days = 0 # allow immediate re-create during development
}

# Writes the key value (from gitignored terraform.tfvars) into the secret.
resource "aws_secretsmanager_secret_version" "massive" {
  secret_id     = aws_secretsmanager_secret.massive.id
  secret_string = var.massive_api_key
}

# Gemini key for the day-explainer chat; same pattern as the Massive key.
resource "aws_secretsmanager_secret" "gemini" {
  name                    = "${var.project}-gemini-api-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "gemini" {
  secret_id     = aws_secretsmanager_secret.gemini.id
  secret_string = var.gemini_api_key
}

# Notification channel for pipeline failures.
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}

# Emails alarm notifications to the operator (requires one-time confirmation).
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Fires when the nightly ingest Lambda reports any error, so a silent failure
# can't go unnoticed; missing data (no runs) is not treated as breaching.
resource "aws_cloudwatch_metric_alarm" "ingest_errors" {
  alarm_name          = "${var.project}-ingest-errors"
  alarm_description   = "Daily ingest Lambda reported an error — check CloudWatch logs"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.ingest.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
