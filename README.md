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

## 🚀 Quick Start

### Create a New Customer and Test

**1. Create a test customer in Dwolla:**
\`\`\`bash
node create-test-customer.js
\`\`\`
- Enter CRM Contact ID (e.g., `CUSTOMER123`)
- Enter First Name (e.g., `John`)
- Enter Last Name (e.g., `Doe`)
- Enter Email (e.g., `john@example.com`)
- Choose `y` to update the database automatically

**2. Check funding source status:**
\`\`\`bash
node check-funding.js
\`\`\`
- Enter the CRM Contact ID
- This shows if the funding source is verified or unverified

**3. Verify funding source (if unverified):**
\`\`\`bash
node check-and-verify-funding.js
\`\`\`
- Enter the CRM Contact ID
- Choose `y` to initiate micro-deposits

**4. Verify micro-deposits:**
\`\`\`bash
node verify-micro-deposits.js
\`\`\`
- Enter Funding Source ID (from the previous step)
- Enter Amount 1: `0.03`
- Enter Amount 2: `0.07`

**5. Test the system:**
\`\`\`bash 
- npm run dev
- npm run bill:week

# In another terminal, record usage
curl -X POST http://localhost:3000/ghl/usage \
  -H "Authorization: Bearer <YOUR_GHL_BEARER>" \
  -H "Content-Type: application/json" \
  -d '{"crm_contact_id":"CUSTOMER123","name":"John Doe","email":"john@example.com","units":3,"occurred_at":"2025-01-15T20:30:00Z","idempotency_key":"CUSTOMER123-test-1"}'

# Run billing (in the same terminal as the curl command, or a third terminal)
npm run bill:week
\`\`\`

---

## 🧠 Useful Commands

| Command | Description |
|----------|-------------|
| \`npm run dev\` | Run the server with **nodemon** (auto-reload on save) |
| \`node setup-customer.js\` | Setup a new customer (interactive) |
| \`node create-test-customer.js\` | Create a test Dwolla customer (interactive) |
| \`node check-funding.js\` | Check a customer's funding source status (interactive) |
| \`node check-and-verify-funding.js\` | Check and initiate micro-deposits for verification (interactive) |
| \`node verify-micro-deposits.js\` | Verify micro-deposits (interactive) |
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
  -d '{"crm_contact_id":"CUSTOMER123","name":"John Doe","email":"john@example.com","units":3,"occurred_at":"2025-01-15T20:30:00Z","idempotency_key":"CUSTOMER123-1736974200"}'
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
