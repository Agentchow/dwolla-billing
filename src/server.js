require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { DateTime } = require('luxon');

const app = express();

// Apply raw body parser for Dwolla webhook (must be before JSON parser)
app.use('/dwolla/webhook', express.raw({ type: '*/*' }));

// Apply JSON parser for all other routes
app.use(express.json());

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const TZ = process.env.TZ || 'America/Los_Angeles';

// Configuration
const PRICE_PER_UNIT_CENTS = 400;
const DWOLLA_TOKEN_EXPIRY_BUFFER_SECONDS = 60;

// Logging
const log = require('./utils/logger');

// Webhook handlers
const createGhlUsageHandler = require('./webhooks/ghl-usage');
const createDwollaWebhookHandler = require('./webhooks/dwolla-webhook');

// Token cache
let tokenCache = { token: null, expiresAt: null };

async function getDwollaToken() {
  if (tokenCache.token && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const creds = Buffer.from(`${process.env.DWOLLA_KEY.trim()}:${process.env.DWOLLA_SECRET.trim()}`).toString('base64');
  const res = await fetch(`${process.env.DWOLLA_BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Dwolla token request failed: ${res.status} - ${errorText}`);
  }

  const json = await res.json();
  const expiresIn = json.expires_in || 3600;
  
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (expiresIn - DWOLLA_TOKEN_EXPIRY_BUFFER_SECONDS) * 1000
  };

  log.info('Dwolla token refreshed', { expiresIn });
  return json.access_token;
}

async function dwollaPost(path, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const token = await getDwollaToken();
      const res = await fetch(`${process.env.DWOLLA_BASE}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.dwolla.v1.hal+json',
          Accept: 'application/vnd.dwolla.v1.hal+json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorText = await res.text();
        const error = new Error(`Dwolla API error: ${res.status} - ${errorText}`);
        
        if (res.status === 401 && attempt < retries) {
          tokenCache = { token: null, expiresAt: null };
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        if (res.status >= 400 && res.status < 500) {
          throw error;
        }
        
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          log.warn('Dwolla API request failed, retrying', { attempt, delay, status: res.status });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }

      return { location: res.headers.get('location') };
    } catch (error) {
      if (attempt === retries) throw error;
    }
  }
}

// --- 1) GoHighLevel Usage Webhook ---
app.post('/ghl/usage', createGhlUsageHandler(db));

// --- 2) Weekly billing job ---
app.post('/bill/week', async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (req.get('authorization') !== 'Bearer admin') {
      log.warn('Unauthorized billing job attempt', { ip: req.ip });
      return res.sendStatus(401);
    }

    const end = DateTime.now().setZone(TZ).startOf('week');
    const start = end.minus({ weeks: 1 });

    log.info('Starting weekly billing job', { start: start.toISO(), end: end.toISO() });

    const { rows: customers } = await db.query(`
      WITH usage_totals AS (
        SELECT crm_contact_id, SUM(units) AS units
        FROM usage_ledger
        WHERE occurred_at >= $1 AND occurred_at < $2
          AND invoice_id IS NULL
        GROUP BY crm_contact_id
      )
      SELECT c.crm_contact_id, c.name, c.email, c.dwolla_funding_href, COALESCE(u.units, 0) AS units
      FROM customers c 
      LEFT JOIN usage_totals u USING (crm_contact_id)
      WHERE c.status = 'active' 
        AND c.dwolla_funding_href IS NOT NULL
        AND COALESCE(u.units, 0) > 0
    `, [start.toISO(), end.toISO()]);

    log.info('Found customers to bill', { count: customers.length });

    const results = {
      total: customers.length,
      successful: 0,
      failed: 0,
      skipped: 0,
      total_amount_cents: 0,
      total_amount_dollars: 0,
      errors: []
    };

    for (const customer of customers) {
      const amountCents = Math.round(Number(customer.units) * PRICE_PER_UNIT_CENTS);
      
      if (amountCents <= 0) {
        results.skipped++;
        continue;
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        const resp = await dwollaPost('transfers', {
          _links: {
            source: { href: customer.dwolla_funding_href },
            destination: { href: process.env.DWOLLA_YOUR_FUNDING_HREF }
          },
          amount: { currency: 'USD', value: (amountCents / 100).toFixed(2) },
          metadata: {
            crm_contact_id: customer.crm_contact_id,
            period_start: start.toISO(),
            period_end: end.toISO()
          }
        });

        const invoiceResult = await client.query(
          `INSERT INTO invoices(crm_contact_id, period_start, period_end, amount_cents, dwolla_transfer_href)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [customer.crm_contact_id, start.toISO(), end.toISO(), amountCents, resp.location]
        );

        const invoiceId = invoiceResult.rows[0].id;

        // Mark usage records as billed by linking them to the invoice
        await client.query(
          `UPDATE usage_ledger
           SET invoice_id = $1
           WHERE crm_contact_id = $2
             AND occurred_at >= $3 AND occurred_at < $4
             AND invoice_id IS NULL`,
          [invoiceId, customer.crm_contact_id, start.toISO(), end.toISO()]
        );

        await client.query('COMMIT');
        
        results.successful++;
        results.total_amount_cents += amountCents;
        results.total_amount_dollars += amountCents / 100;
        
        log.info('Billing successful', {
          crm_contact_id: customer.crm_contact_id,
          name: customer.name,
          units: customer.units,
          amount_cents: amountCents,
          amount_dollars: (amountCents / 100).toFixed(2),
          transfer_href: resp.location
        });
      } catch (error) {
        await client.query('ROLLBACK');
        results.failed++;
        results.errors.push({
          crm_contact_id: customer.crm_contact_id,
          error: error.message
        });
        log.error('Billing failed', {
          crm_contact_id: customer.crm_contact_id,
          error: error.message
        });
      } finally {
        client.release();
      }
    }

    const duration = Date.now() - startTime;
    log.info('Weekly billing job completed', { 
      ...results, 
      total_amount_dollars: results.total_amount_dollars.toFixed(2),
      duration 
    });

    res.status(200).json({
      success: true,
      period: { start: start.toISO(), end: end.toISO() },
      results: {
        ...results,
        total_amount_dollars: results.total_amount_dollars.toFixed(2)
      },
      duration
    });
  } catch (error) {
    log.error('Weekly billing job error', {
      error: error.message,
      stack: error.stack,
      duration: Date.now() - startTime
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- 3) Dwolla Webhook ---
app.post('/dwolla/webhook', createDwollaWebhookHandler(db));

// Health check
app.get('/', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.DWOLLA_BASE?.includes('sandbox') ? 'sandbox' : 'production'
  });
});

// Error handling
app.use((err, req, res, next) => {
  log.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log.info('Server started', { port, environment: process.env.DWOLLA_BASE?.includes('sandbox') ? 'sandbox' : 'production' });
});
