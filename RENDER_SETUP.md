# Render Deployment Guide

Step-by-step guide to deploy your Dwolla Billing service to Render.

---

## 🚀 Step 1: Create Render Account

1. Go to [render.com](https://render.com)
2. Sign up for a free account (GitHub login recommended)
3. Verify your email

---

## 📦 Step 2: Prepare Your Repository

Make sure your code is pushed to GitHub:

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

---

## 🗄️ Step 3: Create PostgreSQL Database

1. In Render dashboard, click **"New +"** → **"PostgreSQL"**
2. Configure:
   - **Name**: `dwolla-billing-db`
   - **Database**: `dwolla_billing`
   - **User**: `dwolla_user`
   - **Plan**: Starter (free tier)
   - **Region**: Choose closest to you
3. Click **"Create Database"**
4. Wait for database to be created (~2 minutes)
5. **Copy the Internal Database URL** (you'll need this)

---

## 🌐 Step 4: Deploy Web Service

### Option A: Using render.yaml (Recommended)

1. In Render dashboard, click **"New +"** → **"Blueprint"**
2. Connect your GitHub repository
3. Select the repository containing your code
4. Render will detect `render.yaml` and create services automatically
5. Review the services and click **"Apply"**

### Option B: Manual Setup

1. In Render dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Select your repository
4. Configure:
   - **Name**: `dwolla-billing`
   - **Environment**: `Node`
   - **Region**: Same as database
   - **Branch**: `main`
   - **Root Directory**: (leave empty)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Starter (free tier)

---

## 🔐 Step 5: Set Environment Variables

In your Web Service dashboard, go to **"Environment"** tab and add:

### Required Variables:

```
PORT=10000
TZ=America/Los_Angeles
NODE_ENV=production
```

### GoHighLevel:

```
GHL_BEARER=your-ghl-bearer-token-here
```

### Dwolla (Production):

```
DWOLLA_ENV=production
DWOLLA_BASE=https://api.dwolla.com
DWOLLA_KEY=your-dwolla-key-here
DWOLLA_SECRET=your-dwolla-secret-here
DWOLLA_WEBHOOK_SECRET=your-dwolla-webhook-secret-here
DWOLLA_YOUR_FUNDING_HREF=https://api.dwolla.com/funding-sources/your-funding-source-id
```

### Database:

```
DATABASE_URL=postgresql://dwolla_user:password@dpg-xxxxx-a/dwolla_billing
```

**Note**: If you created the database in Render, the `DATABASE_URL` is automatically set. You can find it in the database dashboard under "Connections" → "Internal Database URL".

---

## 🗃️ Step 6: Run Database Migration

Once your service is deployed:

1. Go to your Web Service dashboard
2. Click **"Shell"** tab (or use **"Logs"** to see deployment status)
3. Run the migration:
   ```bash
   npm run migrate
   ```

Or use Render's Shell:
1. Click **"Shell"** in your service dashboard
2. Run: `npm run migrate`

---

## ⏰ Step 7: Set Up Weekly Cron Job

1. In Render dashboard, click **"New +"** → **"Cron Job"**
2. Configure:
   - **Name**: `weekly-billing`
   - **Schedule**: `0 0 * * 0` (Every Sunday at midnight UTC)
   - **Command**: 
     ```bash
     curl -X POST -H "Authorization: Bearer admin" https://dwolla-billing.onrender.com/bill/week
     ```
     **Important**: Replace `dwolla-billing.onrender.com` with your actual service URL (found in your service dashboard)
   - **Plan**: Free
3. Click **"Create Cron Job"**

### Alternative: Using Environment Variable

You can also set the service URL as an environment variable:

1. In Cron Job dashboard, go to **"Environment"** tab
2. Add:
   ```
   BILLING_URL=https://dwolla-billing.onrender.com
   AUTH_TOKEN=admin
   ```
3. Update command to:
   ```bash
   curl -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" ${BILLING_URL}/bill/week
   ```

---

## ✅ Step 8: Verify Deployment

### 1. Check Health Endpoint

```bash
curl https://dwolla-billing.onrender.com/
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T20:30:00.000Z",
  "environment": "production"
}
```

### 2. Test Webhook Endpoint

```bash
curl -X POST https://dwolla-billing.onrender.com/ghl/usage \
  -H "Authorization: Bearer YOUR_GHL_BEARER" \
  -H "Content-Type: application/json" \
  -d '{
    "crm_contact_id": "TEST",
    "name": "Test User",
    "email": "test@example.com",
    "units": 1,
    "occurred_at": "2025-01-15T20:30:00Z",
    "idempotency_key": "test-123"
  }'
```

### 3. Test Billing Endpoint (Manual)

```bash
curl -X POST https://dwolla-billing.onrender.com/bill/week \
  -H "Authorization: Bearer admin"
```

---

## 🔗 Step 9: Configure Webhooks

### GoHighLevel Webhook

1. In GoHighLevel, go to **Settings → Integrations → Webhooks**
2. Add webhook:
   - **URL**: `https://dwolla-billing.onrender.com/ghl/usage`
   - **Method**: `POST`
   - **Headers**: 
     - `Authorization: Bearer YOUR_GHL_BEARER`
     - `Content-Type: application/json`

### Dwolla Webhook

1. In Dwolla Dashboard, go to **Settings → Webhooks**
2. Add webhook:
   - **URL**: `https://dwolla-billing.onrender.com/dwolla/webhook`
   - **Events**: `transfer_completed`, `transfer_failed`
   - **Secret**: Same as `DWOLLA_WEBHOOK_SECRET`

---

## 📊 Step 10: Monitor Your Service

1. **Logs**: Check service logs in Render dashboard
2. **Metrics**: View CPU, memory, and request metrics
3. **Cron Jobs**: Check cron job execution logs

---

## 🔄 Updating Your Service

After making code changes:

1. Push to GitHub:
   ```bash
   git add .
   git commit -m "Update billing logic"
   git push origin main
   ```

2. Render will automatically detect changes and redeploy

3. If you need to run migrations again:
   - Go to Shell tab
   - Run: `npm run migrate`

---

## 🐛 Troubleshooting

### Service Won't Start

- Check logs in Render dashboard
- Verify all environment variables are set
- Ensure `DATABASE_URL` is correct

### Database Connection Issues

- Verify `DATABASE_URL` is set correctly
- Check database is running (green status)
- Ensure database and service are in same region

### Cron Job Not Running

- Check cron job logs
- Verify the service URL is correct
- Ensure the service is running (not sleeping)

### Webhooks Not Working

- Verify webhook URL is publicly accessible
- Check service logs for incoming requests
- Verify Bearer token matches `GHL_BEARER`

---

## 💰 Cost

**Free Tier:**
- Web Service: Free (sleeps after 15 min inactivity)
- PostgreSQL: Free (90 days, then $7/month)
- Cron Job: Free

**Paid Tier (Starter - $7/month):**
- Web Service: Always on
- PostgreSQL: Included
- Cron Job: Free

---

## 📝 Next Steps

1. ✅ Service deployed
2. ✅ Database migrated
3. ✅ Cron job scheduled
4. ✅ Webhooks configured
5. ✅ Test the system

**Your webhook URL:**
```
https://dwolla-billing.onrender.com/ghl/usage
```

**Your billing endpoint:**
```
https://dwolla-billing.onrender.com/bill/week
```

---

Need help? Check the [main README](./README.md) or [WEBHOOKS.md](./WEBHOOKS.md) for more details.

