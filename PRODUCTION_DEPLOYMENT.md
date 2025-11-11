# Production Deployment Guide

Step-by-step guide to deploy your Dwolla Billing service to production on Render.

---

## 🚨 Pre-Deployment Checklist

Before deploying to production, make sure:

- [ ] Code is tested and working locally
- [ ] Database migrations are ready (`001_schema.sql` and `002_add_invoice_id_to_usage.sql`)
- [ ] You have production Dwolla credentials
- [ ] You have your production bank account funding source HREF
- [ ] You have a strong `GHL_BEARER` token
- [ ] You have a strong `DWOLLA_WEBHOOK_SECRET`

---

## 📦 Step 1: Prepare Code for Production

### 1.1 Commit All Changes

```bash
git add .
git commit -m "Prepare for production deployment"
git push origin main
```

### 1.2 Verify Migrations

Make sure both migrations are in the `sql/` folder:
- `sql/001_schema.sql` - Main schema
- `sql/002_add_invoice_id_to_usage.sql` - Double-billing prevention

---

## 🗄️ Step 2: Create Production Database on Render

1. Go to [render.com](https://render.com) and log in
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `dwolla-billing-prod-db`
   - **Database**: `dwolla_billing_prod`
   - **User**: `dwolla_user`
   - **Plan**: Starter ($7/month) or higher
   - **Region**: Choose closest to you
4. Click **"Create Database"**
5. Wait for database to be created (~2 minutes)
6. **Copy the Internal Database URL** from the database dashboard

---

## 🌐 Step 3: Deploy Web Service

1. In Render dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Select your repository
4. Configure:
   - **Name**: `dwolla-billing-prod`
   - **Environment**: `Node`
   - **Region**: Same as database
   - **Branch**: `main`
   - **Root Directory**: (leave empty)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Starter ($7/month) - keeps service always on
5. Click **"Create Web Service"**

---

## 🔐 Step 4: Set Production Environment Variables

In your Web Service dashboard, go to **"Environment"** tab and add:

### Required Variables:

```
PORT=10000
TZ=America/Los_Angeles
NODE_ENV=production
```

### GoHighLevel:

```
GHL_BEARER=your-production-ghl-bearer-token-here
```
**⚠️ Use a strong, random token for production!**

### Dwolla (Production):

```
DWOLLA_ENV=production
DWOLLA_BASE=https://api.dwolla.com
DWOLLA_KEY=your-production-dwolla-key
DWOLLA_SECRET=your-production-dwolla-secret
DWOLLA_WEBHOOK_SECRET=your-production-dwolla-webhook-secret
DWOLLA_YOUR_FUNDING_HREF=https://api.dwolla.com/funding-sources/your-production-funding-source-id
```

**⚠️ Important:**
- Use **production** Dwolla credentials (not sandbox)
- Get your production funding source HREF from Dwolla dashboard
- Set up webhook secret in Dwolla dashboard

### Database:

```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

**Note**: Render automatically sets this if you link the database to the service.

---

## 🗃️ Step 5: Run Database Migrations

Once your service is deployed:

1. Go to your Web Service dashboard
2. Click **"Shell"** tab
3. Run migrations:

```bash
# Run main schema
npm run migrate

# Run double-billing prevention migration
npm run migrate:002
```

Or use Render's Shell:
1. Click **"Shell"** in your service dashboard
2. Run: `npm run migrate`
3. Run: `npm run migrate:002`

---

## 👤 Step 6: Set Up Your Test Customer (Your Bank Account)

### Option 1: Using the Setup Script (via SSH/Shell)

1. In Render Shell, you can't run interactive scripts easily
2. Instead, use SQL directly (see Option 2)

### Option 2: Using SQL (Recommended)

1. Go to your database dashboard in Render
2. Click **"Connect"** → **"psql"** (or use Render Shell)
3. Run:

```sql
-- Insert your test customer (replace with your actual info)
INSERT INTO customers (crm_contact_id, name, email, dwolla_funding_href, status)
VALUES (
  'YOUR_CRM_ID',  -- Your GoHighLevel contact ID
  'Your Name',
  'your@email.com',
  'https://api.dwolla.com/funding-sources/YOUR_FUNDING_SOURCE_ID',  -- Your production funding source
  'active'
)
ON CONFLICT (crm_contact_id) DO UPDATE
SET dwolla_funding_href = EXCLUDED.dwolla_funding_href,
    status = 'active';
```

**⚠️ Important:**
- Use your **production** Dwolla funding source HREF
- Make sure the funding source is **verified** in Dwolla
- Use your actual GoHighLevel CRM contact ID

---

## ⏰ Step 7: Set Up Weekly Cron Job

1. In Render dashboard, click **"New +"** → **"Cron Job"**
2. Configure:
   - **Name**: `weekly-billing-prod`
   - **Schedule**: `0 0 * * 0` (Every Sunday at midnight UTC)
   - **Command**: 
     ```bash
     curl -X POST -H "Authorization: Bearer admin" https://dwolla-billing-prod.onrender.com/bill/week
     ```
     **Replace `dwolla-billing-prod.onrender.com` with your actual service URL**
   - **Plan**: Free
3. Click **"Create Cron Job"**

**⚠️ Security Note**: Consider changing the `admin` Bearer token to something more secure in production.

---

## 🔗 Step 8: Configure Webhooks

### GoHighLevel Webhook

1. In GoHighLevel, go to **Settings → Integrations → Webhooks**
2. Add webhook:
   - **URL**: `https://dwolla-billing-prod.onrender.com/ghl/usage`
     (Replace with your actual Render URL)
   - **Method**: `POST`
   - **Headers**: 
     - `Authorization: Bearer YOUR_PRODUCTION_GHL_BEARER`
     - `Content-Type: application/json`

### Dwolla Webhook

1. In Dwolla Dashboard (production), go to **Settings → Webhooks**
2. Add webhook:
   - **URL**: `https://dwolla-billing-prod.onrender.com/dwolla/webhook`
     (Replace with your actual Render URL)
   - **Events**: `transfer_completed`, `transfer_failed`
   - **Secret**: Same as your `DWOLLA_WEBHOOK_SECRET` environment variable

---

## ✅ Step 9: Test Production Deployment

### 9.1 Test Health Check

```bash
curl https://dwolla-billing-prod.onrender.com/
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T20:30:00.000Z",
  "environment": "production"
}
```

### 9.2 Test Webhook Endpoint

```bash
curl -X POST https://dwolla-billing-prod.onrender.com/ghl/usage \
  -H "Authorization: Bearer YOUR_PRODUCTION_GHL_BEARER" \
  -H "Content-Type: application/json" \
  -d '{
    "crm_contact_id": "YOUR_CRM_ID",
    "name": "Your Name",
    "email": "your@email.com",
    "units": 1,
    "occurred_at": "2025-01-15T20:30:00Z",
    "idempotency_key": "test-1"
  }'
```

### 9.3 Test Billing (Manual)

```bash
curl -X POST https://dwolla-billing-prod.onrender.com/bill/week \
  -H "Authorization: Bearer admin"
```

**⚠️ Warning**: This will create a real Dwolla transfer! Make sure you're ready.

### 9.4 Verify in Database

Check that usage was recorded and invoice was created:

```sql
-- Check usage
SELECT * FROM usage_ledger ORDER BY occurred_at DESC LIMIT 5;

-- Check invoices
SELECT * FROM invoices ORDER BY id DESC LIMIT 5;
```

---

## 🔒 Step 10: Security Hardening

### 10.1 Change Admin Bearer Token

Update the billing endpoint to use an environment variable:

1. Add to environment variables:
   ```
   BILLING_AUTH_TOKEN=your-strong-random-token-here
   ```

2. Update `src/server.js` line 115:
   ```javascript
   if (req.get('authorization') !== `Bearer ${process.env.BILLING_AUTH_TOKEN || 'admin'}`) {
   ```

3. Update cron job command:
   ```bash
   curl -X POST -H "Authorization: Bearer ${BILLING_AUTH_TOKEN}" https://your-url.onrender.com/bill/week
   ```

### 10.2 IP Allowlisting (Optional)

Consider adding IP allowlisting for webhook endpoints in production.

---

## 📊 Step 11: Monitor Your Service

1. **Check Logs**: Monitor service logs in Render dashboard
2. **Check Metrics**: View CPU, memory, and request metrics
3. **Check Database**: Monitor database usage
4. **Check Cron Jobs**: Verify cron job execution logs

---

## 🧪 Testing with Your Bank Account

### Before First Real Billing:

1. ✅ Verify your funding source is verified in Dwolla
2. ✅ Test webhook endpoint with a small usage event
3. ✅ Verify usage is recorded in database
4. ✅ Test billing manually (will create real transfer!)
5. ✅ Check Dwolla dashboard for transfer
6. ✅ Verify webhook updates invoice status

### First Real Billing:

1. Record some usage for your test customer
2. Wait for weekly cron job OR trigger manually
3. Check invoice was created
4. Check Dwolla dashboard for transfer
5. Verify money arrives in your bank account (3-5 business days)

---

## 🐛 Troubleshooting

### Service Won't Start
- Check logs in Render dashboard
- Verify all environment variables are set
- Check `DATABASE_URL` is correct

### Database Connection Issues
- Verify database is running (green status)
- Check `DATABASE_URL` matches database connection string
- Ensure database and service are in same region

### Webhooks Not Working
- Verify webhook URLs are publicly accessible
- Check service logs for incoming requests
- Verify Bearer tokens match

### Billing Not Working
- Check customer has `status = 'active'`
- Verify `dwolla_funding_href` is set
- Check usage is recorded for billing period
- Verify funding source is verified in Dwolla

---

## 📝 Post-Deployment Checklist

- [ ] Service is running and accessible
- [ ] Database migrations completed
- [ ] Environment variables set correctly
- [ ] Webhook endpoints tested
- [ ] Test customer set up with your bank account
- [ ] Cron job scheduled
- [ ] Webhooks configured in GoHighLevel and Dwolla
- [ ] Test billing completed successfully
- [ ] Monitoring set up

---

## 🎯 Your Production URLs

After deployment, your URLs will be:

- **Webhook URL**: `https://dwolla-billing-prod.onrender.com/ghl/usage`
- **Dwolla Webhook**: `https://dwolla-billing-prod.onrender.com/dwolla/webhook`
- **Billing Endpoint**: `https://dwolla-billing-prod.onrender.com/bill/week`
- **Health Check**: `https://dwolla-billing-prod.onrender.com/`

---

## 💰 Production Costs

- **Web Service**: $7/month (Starter plan - always on)
- **PostgreSQL**: $7/month (Starter plan)
- **Cron Job**: Free
- **Dwolla ACH**: $0.25 per transfer
- **Total**: ~$14/month + $0.25 per transfer

---

**Ready to deploy?** Follow the steps above and you'll be live in production! 🚀

