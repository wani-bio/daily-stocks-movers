output "dynamodb_table" {
  value = aws_dynamodb_table.movers.name
}

output "ingest_lambda" {
  value = aws_lambda_function.ingest.function_name
}

output "api_url" {
  value = "${aws_apigatewayv2_api.movers.api_endpoint}/movers"
}
