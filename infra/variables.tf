variable "project" {
  description = "Project name used as a prefix for all resources"
  type        = string
  default     = "stock-movers"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "massive_api_key" {
  description = "Massive API key (set in terraform.tfvars — never committed)"
  type        = string
  sensitive   = true
}

variable "massive_base_url" {
  description = "Massive API base URL"
  type        = string
  default     = "https://api.massive.com"
}

variable "watchlist" {
  description = "Comma-separated tickers to track"
  type        = string
  default     = "AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA"
}

variable "gemini_api_key" {
  description = "Google Gemini API key for the day-explainer chat (set in terraform.tfvars — never committed)"
  type        = string
  sensitive   = true
}

variable "gemini_model" {
  description = "Gemini model for the chat endpoint"
  type        = string
  default     = "gemini-2.5-flash"
}

variable "alert_email" {
  description = "Email address for ingest-failure CloudWatch alerts"
  type        = string
}

variable "ingest_schedule" {
  description = "EventBridge cron for daily ingestion (06:00 UTC = well after US market close; 01:30 proved too early for the API's data settle)"
  type        = string
  default     = "cron(0 6 ? * TUE-SAT *)" # Tue-Sat UTC = Mon-Fri market days
}
