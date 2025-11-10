#!/bin/bash
# Weekly Billing Cron Job Script
# This script calls the billing endpoint to bill customers weekly

# Get the service URL from environment variable, or use default
SERVICE_URL="${BILLING_SERVICE_URL:-http://localhost:3000}"
AUTH_TOKEN="${BILLING_AUTH_TOKEN:-admin}"

# Call the billing endpoint
curl -X POST \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/bill/week"

# Exit with curl's exit code
exit $?

