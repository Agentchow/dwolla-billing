/**
 * GoHighLevel Usage Webhook Handler
 * Receives billable events from GoHighLevel CRM
 */
const { DateTime } = require('luxon');
const log = require('../utils/logger');

/**
 * Validate the usage webhook payload
 */
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

/**
 * Create the GoHighLevel usage webhook handler
 */
function createGhlUsageHandler(db) {
  return async (req, res) => {
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
  };
}

module.exports = createGhlUsageHandler;

