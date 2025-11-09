require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { DateTime } = require('luxon');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const TZ = process.env.TZ || 'America/Los_Angeles';

// Configuration
const PRICE_PER_UNIT_CENTS = 400;
const DWOLLA_TOKEN_EXPIRY_BUFFER_SECONDS = 60;

// Logging
const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta, timestamp: new Date().toISOString() }))
};

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

function verifyDwollaWebhookSignature(req, secret) {
  if (!secret) {
    log.warn('DWOLLA_WEBHOOK_SECRET not set, skipping signature verification');
    return true;
  }

  const signature = req.headers['x-request-signature-sha256'];
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.body);
  const calculated = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(calculated)
  );
}

function validateUsageWebhook(body) {
  const errors = [];
  
  if (!body.crm_contact_id || typeof body.crm_contact_id !== 'string') {
    errors.push('crm_contact_id is required and must be a string');
  }
  if (!body.idempotency_key || typeof body.idempotency_key !== 'string') {
    errors.push('idempotency_key is required and must be a string');
  }
  if (body.units === undefined || body.units === null || isNaN(Number(body.units)) || Number(body.units) <= 0) {
    errors.push('units is required and must be a positive number');
  }
  if (!body.occurred_at || !DateTime.fromISO(body.occurred_at).isValid) {
    errors.push('occurred_at is required and must be a valid ISO 8601 timestamp');
  }
  
  return errors;
}

// --- 1) Usage webhook ---
app.post('/ghl/usage', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Authentication
    if (req.get('authorization') !== `Bearer ${process.env.GHL_BEARER}`) {
      log.warn('Unauthorized GHL webhook attempt', { ip: req.ip });
      return res.sendStatus(401);
    }

    // Validation
    const validationErrors = validateUsageWebhook(req.body);
    if (validationErrors.length > 0) {
      log.warn('Invalid GHL webhook payload', { errors: validationErrors, body: req.body });
      return res.status(400).json({ error: 'Invalid payload', details: validationErrors });
    }

    const { crm_contact_id, name, email, units, occurred_at, idempotency_key } = req.body;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(
        `INSERT INTO customers(crm_contact_id, name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (crm_contact_id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email`,
        [crm_contact_id, name, email]
      );

      const usageResult = await client.query(
        `INSERT INTO usage_ledger(idempotency_key, crm_contact_id, units, occurred_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotency_key, crm_contact_id, Number(units), occurred_at]
      );

      await client.query('COMMIT');
      
      const isNew = usageResult.rows.length > 0;
      log.info('Usage recorded', { 
        crm_contact_id, 
        units: Number(units), 
        isNew,
        duration: Date.now() - startTime
      });

      res.status(200).json({ 
        success: true, 
        recorded: isNew,
        message: isNew ? 'Usage recorded' : 'Duplicate request ignored'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('GHL webhook error', { 
      error: error.message, 
      stack: error.stack,
      duration: Date.now() - startTime
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

        await client.query(
          `INSERT INTO invoices(crm_contact_id, period_start, period_end, amount_cents, dwolla_transfer_href)
           VALUES ($1, $2, $3, $4, $5)`,
          [customer.crm_contact_id, start.toISO(), end.toISO(), amountCents, resp.location]
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

// --- 3) Dwolla webhook ---
app.post('/dwolla/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Verify webhook signature
    if (!verifyDwollaWebhookSignature(req, process.env.DWOLLA_WEBHOOK_SECRET)) {
      log.warn('Invalid Dwolla webhook signature', { ip: req.ip });
      return res.sendStatus(401);
    }

    const evt = JSON.parse(req.body.toString());
    const href = evt?._links?.resource?.href;
    const topic = evt?.topic;

    if (!href || !topic) {
      log.warn('Invalid Dwolla webhook payload', { topic, hasHref: !!href });
      return res.sendStatus(200); // Return 200 to prevent retries
    }

    log.info('Processing Dwolla webhook', { topic, href });

    if (topic === 'transfer_completed') {
      const result = await db.query(
        `UPDATE invoices 
         SET status = 'completed', updated_at = now()
         WHERE dwolla_transfer_href = $1 AND status != 'completed'
         RETURNING id, crm_contact_id, amount_cents`,
        [href]
      );
      
      if (result.rows.length > 0) {
        log.info('Transfer completed', {
          invoice_id: result.rows[0].id,
          crm_contact_id: result.rows[0].crm_contact_id,
          amount_cents: result.rows[0].amount_cents
        });
      }
    } else if (topic === 'transfer_failed') {
      const result = await db.query(
        `UPDATE invoices 
         SET status = 'failed', updated_at = now()
         WHERE dwolla_transfer_href = $1 AND status != 'failed'
         RETURNING id, crm_contact_id, amount_cents`,
        [href]
      );
      
      if (result.rows.length > 0) {
        log.error('Transfer failed', {
          invoice_id: result.rows[0].id,
          crm_contact_id: result.rows[0].crm_contact_id,
          amount_cents: result.rows[0].amount_cents
        });
      }
    }

    res.sendStatus(200);
  } catch (error) {
    log.error('Dwolla webhook error', {
      error: error.message,
      stack: error.stack,
      duration: Date.now() - startTime
    });
    res.sendStatus(200); // Return 200 to prevent Dwolla from retrying
  }
});

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
