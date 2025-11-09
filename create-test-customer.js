#!/usr/bin/env node
/**
 * Create a test Dwolla customer with unverified funding source
 * Usage: node create-test-customer.js
 */

require('dotenv').config({ override: true });
const readline = require('readline');

const { DWOLLA_BASE, DWOLLA_KEY, DWOLLA_SECRET } = process.env;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getToken() {
  const creds = Buffer.from(`${DWOLLA_KEY.trim()}:${DWOLLA_SECRET.trim()}`).toString('base64');
  const res = await fetch(`${DWOLLA_BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed: ${res.status} - ${text}`);
  }
  
  const json = await res.json();
  return json.access_token;
}

async function dwollaPost(token, path, body) {
  const res = await fetch(`${DWOLLA_BASE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.dwolla.v1.hal+json',
      Accept: 'application/vnd.dwolla.v1.hal+json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  
  if (!res.ok) {
    throw new Error(`Dwolla API error: ${res.status} - ${text}`);
  }

  const location = res.headers.get('location');
  return { location, body: text ? JSON.parse(text) : {} };
}

async function createTestCustomer() {
  try {
    console.log('🔧 Create Test Dwolla Customer\n');
    
    const crmContactId = await question('CRM Contact ID: ');
    if (!crmContactId) {
      console.error('❌ CRM Contact ID is required');
      process.exit(1);
    }

    const firstName = await question('First Name: ');
    if (!firstName) {
      console.error('❌ First Name is required');
      process.exit(1);
    }

    const lastName = await question('Last Name: ');
    if (!lastName) {
      console.error('❌ Last Name is required');
      process.exit(1);
    }

    const email = await question('Email: ');
    if (!email) {
      console.error('❌ Email is required');
      process.exit(1);
    }

    console.log('\n🔐 Getting Dwolla token...');
    const token = await getToken();
    console.log('✅ Token obtained\n');

    console.log(`👤 Creating UNVERIFIED Dwolla customer for ${crmContactId}...`);
    console.log('   Name:', `${firstName} ${lastName}`);
    console.log('   Email:', email);
    
    const customerPayload = {
      firstName,
      lastName,
      email,
      type: 'personal',
      address1: '123 Test St',
      city: 'Test City',
      state: 'CA',
      postalCode: '90210',
      dateOfBirth: '1990-01-01',
      ssn: '1234'
    };

    const customerResp = await dwollaPost(token, 'customers', customerPayload);
    const customerHref = customerResp.location;
    console.log('✅ Customer created:', customerHref);

    console.log('\n💳 Adding funding source (test bank account)...');
    
    const fundingSourcePayload = {
      routingNumber: '222222226',
      accountNumber: '123456789',
      bankAccountType: 'checking',
      name: `${firstName} Test Checking`
    };

    const customerId = customerHref.split('/customers/')[1];
    const fundingResp = await dwollaPost(token, `customers/${customerId}/funding-sources`, fundingSourcePayload);
    const fundingSourceHref = fundingResp.location;
    console.log('✅ Funding source created:', fundingSourceHref);

    console.log('\n📋 Summary:');
    console.log('  Customer Type: Unverified Personal (can send funds)');
    console.log('  Customer HREF:', customerHref);
    console.log('  Funding Source HREF:', fundingSourceHref);
    console.log(`\n🎯 Update ${crmContactId} in your database:`);
    console.log(`\npsql "${process.env.DATABASE_URL}" -c "UPDATE customers SET dwolla_customer_href = '${customerHref}', dwolla_funding_href = '${fundingSourceHref}' WHERE crm_contact_id = '${crmContactId}';"\n`);

    const updateNow = await question('Would you like to update the database now? (y/n): ');
    if (updateNow.toLowerCase() === 'y') {
      const { Pool } = require('pg');
      const db = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await db.query(
          `INSERT INTO customers (crm_contact_id, name, email, dwolla_customer_href, dwolla_funding_href, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           ON CONFLICT (crm_contact_id) DO UPDATE
           SET name = EXCLUDED.name,
               email = EXCLUDED.email,
               dwolla_customer_href = EXCLUDED.dwolla_customer_href,
               dwolla_funding_href = EXCLUDED.dwolla_funding_href,
               status = 'active'`,
          [crmContactId, `${firstName} ${lastName}`, email, customerHref, fundingSourceHref]
        );
        console.log('✅ Database updated!');
      } finally {
        await db.end();
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    rl.close();
  }
}

createTestCustomer();
