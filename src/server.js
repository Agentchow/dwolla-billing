require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { DateTime } = require('luxon');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const TZ = process.env.TZ || 'America/Los_Angeles';

// --- Configuration ---
const PRICE_PER_UNIT_CENTS = 400; // $4 per webhook trigger
const DWOLLA_TOKEN_EXPIRY_BUFFER_SECONDS = 60; // Refresh token 60s before expiry

// --- Logging utility ---
const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta, timestamp: new Date().toISOString() }))
};

// --- Token caching ---
let tokenCache = {
  token: null,
  expiresAt: null
};

async function getDwollaToken() {
  // Return cached token if still valid
  if (tokenCache.token && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  try {
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
    
    // Cache token with expiry buffer
    tokenCache = {
      token: json.access_token,
      expiresAt: Date.now() + (expiresIn - DWOLLA_TOKEN_EXPIRY_BUFFER_SECONDS) * 1000
    };

    log.info('Dwolla token refreshed', { expiresIn });
    return json.access_token;
  } catch (error) {
    log.error('Failed to get Dwolla token', { error: error.message });
    throw error;
  }
}

// --- Dwolla API helpers ---
async function dwollaPost(path, body, retries = 3) {
  let lastError;
  
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
        
        // Handle 401 (Unauthorized) - token might have expired, clear cache and retry once
        if (res.status === 401 && attempt < retries) {
          log.warn('Token expired or invalid, clearing cache and retrying', { attempt });
          tokenCache = { token: null, expiresAt: null }; // Clear cache
          const delay = 1000; // Short delay before retry
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Don't retry on other 4xx errors (client errors)
        if (res.status >= 400 && res.status < 500) {
          throw error;
        }
        
        // Retry on 5xx errors
        lastError = error;
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          log.warn(`Dwolla API request failed, retrying`, { attempt, delay, status: res.status });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }

      const location = res.headers.get('location');
      return { location };
    } catch (error) {
      lastError = error;
      if (attempt < retries && error.message.includes('5')) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        log.warn(`Dwolla API request failed, retrying`, { attempt, delay, error: error.message });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  
  throw lastError;
}

// --- Webhook signature verification ---
function verifyDwollaWebhookSignature(req, secret) {
  if (!secret) {
    log.warn('DWOLLA_WEBHOOK_SECRET not set, skipping signature verification');
    return true; // Allow in development if secret not set
  }

  const signature = req.headers['x-request-signature-sha256'];
  if (!signature) {
    log.warn('Missing Dwolla webhook signature header');
    return false;
  }

  const body = req.body;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const calculatedSignature = hmac.digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(calculatedSignature)
  );

  if (!isValid) {
    log.error('Invalid Dwolla webhook signature', { 
      provided: signature.substring(0, 10) + '...',
      calculated: calculatedSignature.substring(0, 10) + '...'
    });
  }

  return isValid;
}

// --- Input validation ---
function validateUsageWebhook(body) {
  const errors = [];
  
  if (!body.crm_contact_id || typeof body.crm_contact_id !== 'string') {
    errors.push('crm_contact_id is required and must be a string');
  }
  
  if (!body.idempotency_key || typeof body.idempotency_key !== 'string') {
    errors.push('idempotency_key is required and must be a string');
  }
  
  if (body.units === undefined || body.units === null || isNaN(Number(body.units))) {
    errors.push('units is required and must be a number');
  } else if (Number(body.units) <= 0) {
    errors.push('units must be greater than 0');
  }
  
  if (!body.occurred_at || !DateTime.fromISO(body.occurred_at).isValid) {
    errors.push('occurred_at is required and must be a valid ISO 8601 timestamp');
  }
  
  return errors;
}

// --- 1) GHL webhook to record usage ---
// GoHighLevel workflow webhook calls this endpoint each time the workflow is triggered
// Each trigger = 1 unit = $4 charge
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
    const unitsNum = Number(units);

    // Use transaction to ensure atomicity
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      // Upsert customer
      await client.query(
        `insert into customers(crm_contact_id, name, email)
         values ($1, $2, $3)
         on conflict (crm_contact_id) do update
         set name = excluded.name, email = excluded.email`,
        [crm_contact_id, name, email]
      );

      // Insert usage (idempotent via unique constraint)
      const usageResult = await client.query(
        `insert into usage_ledger(idempotency_key, crm_contact_id, units, occurred_at)
         values ($1, $2, $3, $4)
         on conflict (idempotency_key) do nothing
         returning id`,
        [idempotency_key, crm_contact_id, unitsNum, occurred_at]
      );

      await client.query('COMMIT');
      
      const isNew = usageResult.rows.length > 0;
      log.info('GHL usage recorded', { 
        crm_contact_id, 
        units: unitsNum, 
        idempotency_key, 
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

// --- 2) weekly billing job ---
// Weekly cron job calls this endpoint to aggregate usage and bill via Dwolla
// Charges $4 per webhook trigger (400 cents per unit)
app.post('/bill/week', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Authentication
    if (req.get('authorization') !== 'Bearer admin') {
      log.warn('Unauthorized billing job attempt', { ip: req.ip });
      return res.sendStatus(401);
    }

    const end = DateTime.now().setZone(TZ).startOf('week');
    const start = end.minus({ weeks: 1 });

    log.info('Starting weekly billing job', { start: start.toISO(), end: end.toISO() });

    // Get customers with usage for the period
    const { rows } = await db.query(`
      with agg as (
        select crm_contact_id, sum(units) units
        from usage_ledger
        where occurred_at >= $1 and occurred_at < $2
        group by 1
      )
      select c.crm_contact_id, c.name, c.email, c.dwolla_funding_href, coalesce(a.units, 0) units
      from customers c 
      left join agg a using (crm_contact_id)
      where c.status = 'active' 
        and c.dwolla_funding_href is not null
        and coalesce(a.units, 0) > 0
    `, [start.toISO(), end.toISO()]);

    log.info('Found customers to bill', { count: rows.length });

    const results = {
      total: rows.length,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    // Process each customer
    for (const r of rows) {
      const cents = Math.round(Number(r.units) * PRICE_PER_UNIT_CENTS);
      
      if (cents <= 0) {
        results.skipped++;
        log.warn('Skipping customer with zero amount', { crm_contact_id: r.crm_contact_id });
        continue;
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Create transfer via Dwolla
        let transferHref;
        try {
          const resp = await dwollaPost('transfers', {
            _links: {
              source: { href: r.dwolla_funding_href },
              destination: { href: process.env.DWOLLA_YOUR_FUNDING_HREF }
            },
            amount: { currency: 'USD', value: (cents / 100).toFixed(2) },
            metadata: {
              crm_contact_id: r.crm_contact_id,
              period_start: start.toISO(),
              period_end: end.toISO()
            }
          });
          transferHref = resp.location;
        } catch (error) {
          await client.query('ROLLBACK');
          results.failed++;
          results.errors.push({
            crm_contact_id: r.crm_contact_id,
            error: error.message
          });
          log.error('Failed to create Dwolla transfer', {
            crm_contact_id: r.crm_contact_id,
            amount_cents: cents,
            error: error.message
          });
          continue;
        }

        // Record invoice in database
        await client.query(
          `insert into invoices(crm_contact_id, period_start, period_end, amount_cents, dwolla_transfer_href)
           values ($1, $2, $3, $4, $5)`,
          [r.crm_contact_id, start.toISO(), end.toISO(), cents, transferHref]
        );

        await client.query('COMMIT');
        results.successful++;
        
        log.info('Billing successful', {
          crm_contact_id: r.crm_contact_id,
          units: r.units,
          amount_cents: cents,
          transfer_href: transferHref
        });
      } catch (error) {
        await client.query('ROLLBACK');
        results.failed++;
        results.errors.push({
          crm_contact_id: r.crm_contact_id,
          error: error.message
        });
        log.error('Billing transaction failed', {
          crm_contact_id: r.crm_contact_id,
          error: error.message,
          stack: error.stack
        });
      } finally {
        client.release();
      }
    }

    const duration = Date.now() - startTime;
    log.info('Weekly billing job completed', { ...results, duration });

    res.status(200).json({
      success: true,
      period: { start: start.toISO(), end: end.toISO() },
      results,
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

// --- 3) Dwolla webhook listener ---
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

    // Update invoice status based on webhook topic
    if (topic === 'transfer_completed') {
      const result = await db.query(
        `update invoices 
         set status = 'completed', updated_at = now()
         where dwolla_transfer_href = $1 
           and status != 'completed'
         returning id, crm_contact_id, amount_cents`,
        [href]
      );
      
      if (result.rows.length > 0) {
        log.info('Transfer marked as completed', {
          invoice_id: result.rows[0].id,
          crm_contact_id: result.rows[0].crm_contact_id,
          amount_cents: result.rows[0].amount_cents
        });
      } else {
        log.warn('Transfer completion webhook received but no invoice found or already completed', { href });
      }
    } else if (topic === 'transfer_failed') {
      const result = await db.query(
        `update invoices 
         set status = 'failed', updated_at = now()
         where dwolla_transfer_href = $1 
           and status != 'failed'
         returning id, crm_contact_id, amount_cents`,
        [href]
      );
      
      if (result.rows.length > 0) {
        log.error('Transfer marked as failed', {
          invoice_id: result.rows[0].id,
          crm_contact_id: result.rows[0].crm_contact_id,
          amount_cents: result.rows[0].amount_cents
        });
      } else {
        log.warn('Transfer failure webhook received but no invoice found or already failed', { href });
      }
    } else {
      log.info('Unhandled Dwolla webhook topic', { topic, href });
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

// --- Health check ---
app.get('/', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.DWOLLA_BASE?.includes('sandbox') ? 'sandbox' : 'production'
  });
});

// --- Error handling middleware ---
app.use((err, req, res, next) => {
  log.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log.info('Server started', { port, environment: process.env.DWOLLA_BASE?.includes('sandbox') ? 'sandbox' : 'production' });
});
