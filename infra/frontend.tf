# --- Frontend hosting: React SPA on S3 static website hosting ---
# Content is uploaded by CI (aws s3 sync frontend/dist), not by Terraform.

# The site bucket; account ID suffix keeps the name globally unique.
resource "aws_s3_bucket" "site" {
  bucket = "${var.project}-site-${data.aws_caller_identity.current.account_id}"
}

# Looks up the current AWS account ID for the bucket name above.
data "aws_caller_identity" "current" {}

# Turns the bucket into a website endpoint; errors route back to index.html
# so SPA client-side routing works on refresh/deep links.
resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html" # SPA: route everything to the app
  }
}

# Public-access settings: ACLs stay blocked; only a bucket *policy* may grant
# public read (required for static website hosting).
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

# Grants the public exactly one permission: read objects. No list, no write.
resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  depends_on = [aws_s3_bucket_public_access_block.site]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
    }]
  })
}
