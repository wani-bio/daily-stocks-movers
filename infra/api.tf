# --- Retrieval side: API Gateway -> Lambda -> DynamoDB (read-only) ---

# Zips the retrieval handler for Lambda deployment.
data "archive_file" "api" {
  type        = "zip"
  source_file = "${path.module}/../src/api/handler.py"
  output_path = "${path.module}/build/api.zip"
}

# Execution role the API Lambda assumes; grants nothing by itself.
resource "aws_iam_role" "api" {
  name = "${var.project}-api-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Least privilege for retrieval: read the one table, emit logs. No writes,
# no secrets — the API side never talks to the stock API.
resource "aws_iam_role_policy" "api" {
  name = "${var.project}-api-policy"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = aws_dynamodb_table.movers.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# The retrieval function: returns the last 7 recorded movers as JSON.
resource "aws_lambda_function" "api" {
  function_name    = "${var.project}-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      DDB_TABLE = aws_dynamodb_table.movers.name
    }
  }
}

# Public HTTP API. CORS is locked to the site's origin (plus localhost for dev)
# so arbitrary websites can't call it from a browser.
resource "aws_apigatewayv2_api" "movers" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["http://${aws_s3_bucket_website_configuration.site.website_endpoint}", "http://localhost:4173", "http://localhost:5173"]
    allow_methods = ["GET"]
    allow_headers = ["Content-Type"]
    max_age       = 3600
  }
}

# Connects the HTTP API to the retrieval Lambda (proxy integration).
resource "aws_apigatewayv2_integration" "movers" {
  api_id                 = aws_apigatewayv2_api.movers.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# The one public route: GET /movers.
resource "aws_apigatewayv2_route" "movers" {
  api_id    = aws_apigatewayv2_api.movers.id
  route_key = "GET /movers"
  target    = "integrations/${aws_apigatewayv2_integration.movers.id}"
}

# Default stage with throttling so a public URL can't rack up free-tier usage.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.movers.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}

# Lets API Gateway (and only this API) invoke the retrieval Lambda.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.movers.execution_arn}/*/*"
}
