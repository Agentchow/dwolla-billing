/**
 * Dwolla Webhook Handler
 * Receives transfer status updates from Dwolla
 */
const crypto = require('crypto');
const log = require('../utils/logger');

/**
 * Verify Dwolla webhook signature
 */
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

/**
 * Create the Dwolla webhook handler
 */
function createDwollaWebhookHandler(db) {
  return async (req, res) => {
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
  };
}

module.exports = createDwollaWebhookHandler;

