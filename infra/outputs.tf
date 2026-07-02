output "dynamodb_table" {
  value = aws_dynamodb_table.movers.name
}

output "ingest_lambda" {
  value = aws_lambda_function.ingest.function_name
}

output "api_url" {
  value = "${aws_apigatewayv2_api.movers.api_endpoint}/movers"
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "site_url" {
  value = "http://${aws_s3_bucket_website_configuration.site.website_endpoint}"
}
