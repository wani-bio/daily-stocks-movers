# Pins Terraform and provider versions so every machine deploys the same way.
terraform {
  # Remote state in S3 (with native lockfile) so any machine — including CI —
  # can plan/apply safely. Bootstrap: the state bucket itself is created once
  # via CLI (see README) because Terraform can't store state in a bucket it
  # hasn't created yet.
  backend "s3" {
    bucket       = "stock-movers-tfstate-393818036549"
    key          = "terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }

  required_version = ">= 1.10" # use_lockfile needs 1.10+
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

# AWS provider; default_tags stamps Project/ManagedBy on every resource created.
provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# Storage for the pipeline's results: one small row per trading day,
# keyed by date. On-demand billing keeps it free at this volume.
resource "aws_dynamodb_table" "movers" {
  name         = "${var.project}-movers"
  billing_mode = "PAY_PER_REQUEST" # free tier: 25 GB + generous request allowance
  hash_key     = "date"

  attribute {
    name = "date"
    type = "S"
  }
}
