# --- Secrets Manager: Massive API key ---
resource "aws_secretsmanager_secret" "massive" {
  name                    = "${var.project}-massive-api-key"
  recovery_window_in_days = 0 # allow immediate re-create during development
}

resource "aws_secretsmanager_secret_version" "massive" {
  secret_id     = aws_secretsmanager_secret.massive.id
  secret_string = var.massive_api_key
}

# --- Alerting: email when a nightly ingest run fails ---
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

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
