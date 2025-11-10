create table if not exists customers(
  crm_contact_id text primary key,
  name text,
  email text,
  dwolla_customer_href text,
  dwolla_funding_href text,
  status text default 'pending'
);

create table if not exists usage_ledger(
  id serial primary key,
  idempotency_key text unique not null,
  crm_contact_id text not null,
  units numeric not null,
  occurred_at timestamptz not null,
  invoice_id integer references invoices(id)
);
create index if not exists usage_idx on usage_ledger (crm_contact_id, occurred_at);
create index if not exists usage_ledger_invoice_id_idx on usage_ledger(invoice_id);
create index if not exists usage_ledger_unbilled_idx on usage_ledger(crm_contact_id, occurred_at) where invoice_id is null;

create table if not exists invoices(
  id serial primary key,
  crm_contact_id text not null,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  amount_cents int not null,
  dwolla_transfer_href text,
  status text not null default 'initiated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_transfer_href_idx on invoices (dwolla_transfer_href);
create index if not exists invoices_crm_contact_idx on invoices (crm_contact_id, period_start, period_end);
