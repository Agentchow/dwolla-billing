# Webhook Configuration Guide

This guide explains how to configure webhooks from **GoHighLevel CRM** and **Dwolla API** for your billing automation service.

---

## 📡 Webhook Endpoints

Your server exposes two webhook endpoints that need to be publicly accessible:

1. **GoHighLevel Webhook**: `POST /ghl/usage`
   - Receives billable events from GoHighLevel CRM
   - Requires Bearer token authentication (`GHL_BEARER`)

2. **Dwolla Webhook**: `POST /dwolla/webhook`
   - Receives transfer status updates from Dwolla
   - Uses signature verification (`DWOLLA_WEBHOOK_SECRET`)

---

## 🔧 Configuring Webhooks for Remote Hosting

### 1. GoHighLevel Webhook Configuration

In your GoHighLevel account:

1. Navigate to **Settings → Integrations → Webhooks**
2. Add a new webhook endpoint:
   - **URL**: `https://your-domain.com/ghl/usage`
   - **Method**: `POST`
   - **Headers**: 
     - `Authorization: Bearer <YOUR_GHL_BEARER>`
     - `Content-Type: application/json`
   - **Payload**: Your GoHighLevel webhook payload format

**Expected Payload Format:**
```json
{
  "crm_contact_id": "CUSTOMER123",
  "name": "John Doe",
  "email": "john@example.com",
  "units": 3,
  "occurred_at": "2025-01-15T20:30:00Z",
  "idempotency_key": "CUSTOMER123-1736974200"
}
```

**Security:**
- The endpoint requires Bearer token authentication
- Use the same value as your `GHL_BEARER` environment variable
- Consider adding IP allowlist restrictions for additional security

---

### 2. Dwolla Webhook Configuration

In your Dwolla Dashboard:

1. Navigate to **Settings → Webhooks**
2. Add a new webhook subscription:
   - **URL**: `https://your-domain.com/dwolla/webhook`
   - **Events**: Select `transfer_completed` and `transfer_failed`
   - **Secret**: Use the same value as your `DWOLLA_WEBHOOK_SECRET` environment variable

**Webhook Events:**
- `transfer_completed` - Updates invoice status to `completed` when transfer succeeds
- `transfer_failed` - Updates invoice status to `failed` when transfer fails

**Security:**
- The endpoint uses HMAC-SHA256 signature verification
- The signature is sent in the `X-Request-Signature-Sha256` header
- Ensure your `DWOLLA_WEBHOOK_SECRET` matches the secret configured in Dwolla

---

## 🧪 Testing Webhooks Locally (Development)

For local development, use **ngrok** to expose your local server:

### Setup

```bash
# Terminal 1: Start your server
npm run dev

# Terminal 2: Expose local port
ngrok http 3000
```

### Configure Webhooks with ngrok URL

Use the ngrok URL (e.g., `https://abc123.ngrok.io`) in your webhook configurations:

- **GoHighLevel**: `https://abc123.ngrok.io/ghl/usage`
- **Dwolla**: `https://abc123.ngrok.io/dwolla/webhook`

**Note:** Free ngrok URLs change on each restart. For testing, consider using ngrok's static domain feature or keep the same ngrok session running.

---

## 🖥️ Using Scripts with Remote Hosting

You can still use all the interactive scripts when hosting remotely:

### Option 1: SSH into your server

```bash
ssh user@your-server.com
cd /path/to/dwolla-billing
node create-test-customer.js
```

### Option 2: Run scripts locally, point to remote database

```bash
# Set DATABASE_URL to your remote database
export DATABASE_URL="postgresql://user:pass@remote-host:5432/ghl_dwolla"
node create-test-customer.js
```

**Note**: Ensure your database is accessible remotely with proper security (SSL, firewall rules, IP allowlist).

---

## 🔒 Security Best Practices

### GoHighLevel Webhook (`/ghl/usage`)

1. **Bearer Token Authentication**: Always use a strong, random `GHL_BEARER` token
2. **IP Allowlist**: If possible, restrict access to GoHighLevel's IP ranges
3. **HTTPS Only**: Always use HTTPS in production
4. **Rate Limiting**: Consider implementing rate limiting to prevent abuse

### Dwolla Webhook (`/dwolla/webhook`)

1. **Signature Verification**: Always verify webhook signatures using `DWOLLA_WEBHOOK_SECRET`
2. **HTTPS Only**: Always use HTTPS in production
3. **Idempotency**: The endpoint is designed to handle duplicate webhook deliveries safely

---

## 🐛 Troubleshooting

### Webhook Not Receiving Events

1. **Check Server Logs**: Look for webhook requests in your server logs
2. **Verify URL**: Ensure the webhook URL is correct and publicly accessible
3. **Test with curl**: Test the endpoint manually:
   ```bash
   # Test GoHighLevel webhook
   curl -X POST https://your-domain.com/ghl/usage \
     -H "Authorization: Bearer <YOUR_GHL_BEARER>" \
     -H "Content-Type: application/json" \
     -d '{"crm_contact_id":"TEST","name":"Test","email":"test@example.com","units":1,"occurred_at":"2025-01-15T20:30:00Z","idempotency_key":"test-123"}'
   
   # Test Dwolla webhook (requires valid signature)
   curl -X POST https://your-domain.com/dwolla/webhook \
     -H "X-Request-Signature-Sha256: <SIGNATURE>" \
     -H "Content-Type: application/json" \
     -d '{"topic":"transfer_completed","_links":{"resource":{"href":"..."}}}'
   ```

### Signature Verification Failing

1. **Check Secret**: Ensure `DWOLLA_WEBHOOK_SECRET` matches the secret in Dwolla dashboard
2. **Raw Body**: The endpoint uses raw body parsing for signature verification
3. **Header Name**: Verify the signature header is `X-Request-Signature-Sha256`

### GoHighLevel Authentication Failing

1. **Check Bearer Token**: Ensure `GHL_BEARER` matches the token in GoHighLevel webhook config
2. **Header Format**: Verify the Authorization header format: `Bearer <TOKEN>`
3. **Case Sensitivity**: Header names are case-insensitive, but the token must match exactly

---

## 📚 Related Documentation

- [Main README](./README.md) - General setup and usage
- [Dwolla API Documentation](https://docs.dwolla.com/)
- [GoHighLevel API Documentation](https://highlevel.stoplight.io/docs/integrations)

