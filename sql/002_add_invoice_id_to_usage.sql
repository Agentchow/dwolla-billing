-- Migration: Add invoice_id to usage_ledger to track which usage has been billed
-- This prevents double-billing while maintaining audit trail

-- Add invoice_id column to usage_ledger
ALTER TABLE usage_ledger 
ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS usage_ledger_invoice_id_idx ON usage_ledger(invoice_id);

-- Add index for unbilled usage queries
CREATE INDEX IF NOT EXISTS usage_ledger_unbilled_idx ON usage_ledger(crm_contact_id, occurred_at) 
WHERE invoice_id IS NULL;

