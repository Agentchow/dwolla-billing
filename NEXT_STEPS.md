# 🚀 Next Steps - Getting Your System Running

## ✅ What You Have
- ✅ Production-ready code with all improvements
- ✅ Database schema ready
- ✅ Dwolla connection tested

## 📋 Step-by-Step Setup

### Step 1: Set Up Database
```bash
# Create database
createdb ghl_dwolla

# Run migrations
npm run migrate
```

### Step 2: Verify Environment Variables
Make sure your `.env` file has all required variables:
```bash
# Check your .env file
cat .env
```

Required variables:
- `DWOLLA_KEY` - Your Dwolla API key
- `DWOLLA_SECRET` - Your Dwolla API secret
- `DWOLLA_BASE` - `https://api-sandbox.dwolla.com` (or production)
- `DWOLLA_YOUR_FUNDING_HREF` - Your Dwolla funding source (your bank account)
- `DWOLLA_WEBHOOK_SECRET` - Webhook signature secret (get from Dwolla dashboard)
- `GHL_BEARER` - Random secure token for GoHighLevel webhooks
- `DATABASE_URL` - PostgreSQL connection string

### Step 3: Set Up Zach's Customer Record

**This is the critical step!** You need to:
1. Create a Dwolla customer for Zach (if not already done)
2. Link Zach's bank account to Dwolla (get funding source)
3. Add Zach's record to your database

**Option A: Use the setup script (recommended)**
```bash
node setup-customer.js
```

**Option B: Manual setup via SQL**
```bash
psql "$DATABASE_URL"
```

Then run:
```sql
-- Update Zach's customer record with Dwolla funding source
UPDATE customers 
SET dwolla_funding_href = 'https://api-sandbox.dwolla.com/funding-sources/YOUR-FUNDING-SOURCE-ID',
    status = 'active'
WHERE crm_contact_id = 'ZACH1';

-- Or insert if doesn't exist
INSERT INTO customers (crm_contact_id, name, email, dwolla_funding_href, status)
VALUES ('ZACH1', 'Zach', 'zach@example.com', 'https://api-sandbox.dwolla.com/funding-sources/YOUR-FUNDING-SOURCE-ID', 'active')
ON CONFLICT (crm_contact_id) DO UPDATE
SET dwolla_funding_href = EXCLUDED.dwolla_funding_href,
    status = 'active';
```

### Step 4: Start the Server
```bash
npm run dev
```

Server should start on `http://localhost:3000`

### Step 5: Test the System

**5a. Test Dwolla Connection**
```bash
node test-dwolla-connection.js
```

**5b. Test GHL Webhook (simulate a trigger)**
```bash
curl -X POST http://localhost:3000/ghl/usage \
  -H "Authorization: Bearer YOUR_GHL_BEARER" \
  -H "Content-Type: application/json" \
  -d '{
    "crm_contact_id": "ZACH1",
    "name": "Zach",
    "email": "zach@example.com",
    "units": 1,
    "occurred_at": "2025-11-09T20:00:00Z",
    "idempotency_key": "ZACH1-test-1"
  }'
```

**5c. Verify Usage Recorded**
```bash
psql "$DATABASE_URL" -c "SELECT * FROM usage_ledger ORDER BY occurred_at DESC LIMIT 5;"
```

**5d. Test Billing (manually trigger weekly billing)**
```bash
npm run bill:week
```

**5e. Check Invoices**
```bash
psql "$DATABASE_URL" -c "SELECT * FROM invoices ORDER BY created_at DESC;"
```

### Step 6: Configure GoHighLevel Webhook

1. Go to your GoHighLevel workflow
2. Add a webhook step
3. Configure:
   - **URL**: `https://your-domain.com/ghl/usage` (or use ngrok for local testing)
   - **Method**: POST
   - **Headers**: 
     - `Authorization: Bearer YOUR_GHL_BEARER`
     - `Content-Type: application/json`
   - **Body** (JSON):
     ```json
     {
       "crm_contact_id": "{{contact.id}}",
       "name": "{{contact.name}}",
       "email": "{{contact.email}}",
       "units": 1,
       "occurred_at": "{{date.now.iso}}",
       "idempotency_key": "{{contact.id}}-{{date.now.timestamp}}"
     }
     ```

### Step 7: Set Up Weekly Cron Job

**Option A: Using cron (Linux/Mac)**
```bash
# Edit crontab
crontab -e

# Add this line (runs every Monday at 9 AM)
0 9 * * 1 curl -X POST -H "Authorization: Bearer admin" http://localhost:3000/bill/week
```

**Option B: Using a hosting service (Render, Railway, etc.)**
- Most hosting services have built-in cron/scheduler
- Set up a scheduled job to call `/bill/week` weekly

**Option C: Using a service like EasyCron or Cron-job.org**
- Set up a webhook that calls your `/bill/week` endpoint weekly

### Step 8: Set Up Dwolla Webhooks

1. Go to Dwolla Dashboard → Webhooks
2. Add webhook URL: `https://your-domain.com/dwolla/webhook`
3. Select events: `transfer_completed`, `transfer_failed`
4. Copy the webhook secret to your `.env` as `DWOLLA_WEBHOOK_SECRET`

### Step 9: Test End-to-End

1. Trigger GoHighLevel workflow (or simulate webhook)
2. Verify usage recorded in database
3. Wait for weekly billing OR manually trigger: `npm run bill:week`
4. Check invoice created
5. Wait for Dwolla webhook (or check Dwolla dashboard)
6. Verify invoice status updated to `completed`

## 🔍 Troubleshooting

### "No customers to bill"
- Check: `SELECT * FROM customers WHERE status = 'active' AND dwolla_funding_href IS NOT NULL;`
- Make sure Zach's record has `status = 'active'` and `dwolla_funding_href` set

### "Dwolla transfer failed"
- Check Dwolla dashboard for error details
- Verify funding source is verified and active
- Check logs: `npm run dev` will show detailed error messages

### "Webhook not working"
- Use ngrok for local testing: `ngrok http 3000`
- Check webhook signature verification is working
- Verify `DWOLLA_WEBHOOK_SECRET` is set correctly

## 📊 Monitoring

### Check Logs
All logs are in JSON format. Watch for:
```bash
npm run dev | jq
```

### Database Queries
```bash
# Check customers
psql "$DATABASE_URL" -c "SELECT * FROM customers;"

# Check usage
psql "$DATABASE_URL" -c "SELECT * FROM usage_ledger ORDER BY occurred_at DESC LIMIT 10;"

# Check invoices
psql "$DATABASE_URL" -c "SELECT * FROM invoices ORDER BY created_at DESC;"
```

## 🎯 Quick Start Checklist

- [ ] Database created and migrated
- [ ] Environment variables configured
- [ ] Zach's customer record set up with Dwolla funding source
- [ ] Server starts successfully
- [ ] Dwolla connection test passes
- [ ] GHL webhook test succeeds
- [ ] Usage recorded in database
- [ ] Billing job runs successfully
- [ ] Invoice created
- [ ] GoHighLevel webhook configured
- [ ] Weekly cron job set up
- [ ] Dwolla webhooks configured

## 🚨 Important Notes

1. **Dwolla Funding Source**: Zach needs to have a verified bank account linked in Dwolla. You'll need to:
   - Create a Dwolla customer for Zach
   - Use Plaid or manual verification to link his bank account
   - Get the funding source HREF and add it to the database

2. **Webhook Security**: 
   - Use strong, random tokens for `GHL_BEARER`
   - Set `DWOLLA_WEBHOOK_SECRET` from Dwolla dashboard
   - Consider IP allowlisting in production

3. **Testing**: 
   - Start with sandbox environment
   - Test thoroughly before going to production
   - Monitor first few billing cycles closely

