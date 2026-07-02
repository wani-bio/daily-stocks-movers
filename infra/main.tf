terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# --- Storage: one row per trading day ---
resource "aws_dynamodb_table" "movers" {
  name         = "${var.project}-movers"
  billing_mode = "PAY_PER_REQUEST" # free tier: 25 GB + generous request allowance
  hash_key     = "date"

  attribute {
    name = "date"
    type = "S"
  }
}
