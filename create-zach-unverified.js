#!/usr/bin/env node
/**
 * Create ZACH1 with a DIFFERENT email to avoid duplicate
 */

require('dotenv').config({ override: true });

const { DWOLLA_BASE, DWOLLA_KEY, DWOLLA_SECRET } = process.env;

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

async function createUnverifiedCustomer() {
  try {
    console.log('🔐 Getting Dwolla token...');
    const token = await getToken();
    console.log('✅ Token obtained\n');

    // Use a unique email to avoid duplicate
    const uniqueEmail = `zach+${Date.now()}@example.com`;
    
    console.log('👤 Creating UNVERIFIED Dwolla customer for ZACH1...');
    console.log('   Email:', uniqueEmail);
    
    const customerPayload = {
      firstName: 'Zach',
      lastName: 'Test',
      email: uniqueEmail,
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
      name: 'Zach Test Checking'
    };

    const customerId = customerHref.split('/customers/')[1];
    const fundingResp = await dwollaPost(token, `customers/${customerId}/funding-sources`, fundingSourcePayload);
    const fundingSourceHref = fundingResp.location;
    console.log('✅ Funding source created:', fundingSourceHref);

    console.log('\n📋 Summary:');
    console.log('  Customer Type: Unverified Personal (can send funds)');
    console.log('  Customer HREF:', customerHref);
    console.log('  Funding Source HREF:', fundingSourceHref);
    console.log('\n🎯 Update ZACH1 in your database:');
    console.log(`\npsql "postgresql://localhost:5432/ghl_dwolla" -c "UPDATE customers SET dwolla_customer_href = '${customerHref}', dwolla_funding_href = '${fundingSourceHref}' WHERE crm_contact_id = 'ZACH1';"\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

createUnverifiedCustomer();
