# Dwolla Billing Automation

A lightweight Node + Express + Postgres service that integrates with **GoHighLevel** and **Dwolla** to automate weekly ACH billing directly to your Bank of America business account.

---

## 📦 Project Structure
\`\`\`
dwolla-billing/
├── src/
│   └── server.js           # main express server
├── sql/
│   └── 001_schema.sql      # database schema
├── .env                    # environment variables (not committed)
├── package.json
└── README.md
\`\`\`

---

## ⚙️ Setup

### 1. Environment
Copy `.env.example` → `.env` and fill in your keys:
\`\`\`
PORT=3000
TZ=America/Los_Angeles
GHL_BEARER=super-long-random

DWOLLA_ENV=sandbox
DWOLLA_BASE=https://api-sandbox.dwolla.com
DWOLLA_KEY=...
DWOLLA_SECRET=...
DWOLLA_WEBHOOK_SECRET=...
DWOLLA_YOUR_FUNDING_HREF=https://api-sandbox.dwolla.com/funding-sources/be995692-4f5c-471a-9d49-216639358d9d

DATABASE_URL=postgresql://localhost:5432/ghl_dwolla
\`\`\`

### 2. Install dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Create the database
\`\`\`bash
createdb ghl_dwolla
npm run migrate
\`\`\`

### 4. Start the dev server
\`\`\`bash
npm run dev
\`\`\`
Server runs on [http://localhost:3000](http://localhost:3000)

---

## 🧠 Useful Commands

| Command | Description |
|----------|-------------|
| \`npm run dev\` | Run the server with **nodemon** (auto-reload on save) |
| \`npm run migrate\` | Apply the SQL schema in \`sql/001_schema.sql\` |
| \`npm run bill:week\` | Manually trigger the weekly Dwolla billing cron |
| \`psql "$DATABASE_URL"\` | Open a Postgres shell to inspect tables |
| \`ngrok http 3000\` | Expose local port for GHL and Dwolla webhooks |
| \`curl -i http://localhost:3000/\` | Quick health check |

---

## 🧩 Integration Overview

1. **GoHighLevel →** Sends webhook to `/ghl/usage` whenever a billable event happens.  
2. **Server →** Logs usage in Postgres.  
3. **Weekly cron or manual trigger →** Calls `/bill/week` to batch totals and post Dwolla transfers.  
4. **Dwolla →** Moves money (ACH) from client → BoA.  
5. **Dwolla webhooks →** `/dwolla/webhook` updates invoice status.

---

## 🧪 Testing

**Simulate a usage event:**
\`\`\`bash
curl -X POST http://localhost:3000/ghl/usage \
  -H "Authorization: Bearer <GHL_BEARER>" \
  -H "Content-Type: application/json" \
  -d '{"crm_contact_id":"ZACH1","name":"Zach","email":"z@x.com","units":3,"occurred_at":"2025-11-07T20:30:00Z","idempotency_key":"ZACH1-1731011400"}'
\`\`\`

**Trigger billing manually:**
\`\`\`bash
npm run bill:week
\`\`\`

**View invoices:**
\`\`\`bash
psql "$DATABASE_URL" -c "select * from invoices;"
\`\`\`

---

## 🧭 Deployment Checklist
- Switch to production Dwolla keys (\`DWOLLA_ENV=production\`)  
- Recreate customers/funding sources in production  
- Lock down:
  - \`/ghl/usage\` with Bearer + IP allowlist  
  - \`/bill/week\` with admin Bearer  
  - \`/dwolla/webhook\` with signature verification  
- Set up real cron job (or Render/host scheduler)  
- Point DNS + SSL (optional)

---

## 🪙 Fees Summary
| Source | Cost |
|---------|------|
| Dwolla ACH | ~$0.25 per transfer |
| Plaid bank link | Free <100/month, then $0.25 each |
| Infra (DB + host) | ~$5–10/mo |
| BoA inbound | $0 |

---

**Author:** Charles Chow  
**Stack:** Node.js, Express, PostgreSQL, Dwolla API, GoHighLevel Webhooks
