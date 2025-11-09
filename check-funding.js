#!/usr/bin/env node
/**
 * Check a customer's funding source status
 * Usage: node check-funding.js
 */

require('dotenv').config({ override: true });
const { Pool } = require('pg');
const readline = require('readline');

const db = new Pool({ connectionString: process.env.DATABASE_URL });
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

async function checkFundingSource() {
  try {
    console.log('🔍 Check Funding Source Status\n');
    
    const crmContactId = await question('CRM Contact ID: ');
    if (!crmContactId) {
      console.error('❌ CRM Contact ID is required');
      process.exit(1);
    }

    const result = await db.query(
      'SELECT crm_contact_id, name, dwolla_funding_href FROM customers WHERE crm_contact_id = $1',
      [crmContactId]
    );

    if (result.rows.length === 0) {
      console.error(`❌ Customer "${crmContactId}" not found in database`);
      process.exit(1);
    }

    const customer = result.rows[0];
    const fundingSourceHref = customer.dwolla_funding_href;
    
    if (!fundingSourceHref) {
      console.error(`❌ Customer "${crmContactId}" has no funding source set`);
      process.exit(1);
    }

    console.log(`\n🔍 Checking ${customer.name}'s Funding Source...\n`);
    console.log('Funding Source HREF:', fundingSourceHref);

    const fundingSourceId = fundingSourceHref.split('/funding-sources/')[1];

    console.log('\n🔐 Getting Dwolla token...');
    const token = await getToken();
    console.log('✅ Token obtained\n');

    console.log('📋 Fetching funding source details...');
    const res = await fetch(`${DWOLLA_BASE}/funding-sources/${fundingSourceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.dwolla.v1.hal+json'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get funding source: ${res.status} - ${text}`);
    }

    const fundingSource = await res.json();
    
    console.log('\n✅ Funding Source Details:');
    console.log('   Name:', fundingSource.name);
    console.log('   Type:', fundingSource.type);
    console.log('   Status:', fundingSource.status);
    console.log('   Bank Name:', fundingSource.bankName || 'N/A');
    
    if (fundingSource.status === 'verified') {
      console.log('\n✅ Funding source is verified! Billing should work.');
    } else if (fundingSource.status === 'unverified') {
      console.log('\n❌ Funding source is UNVERIFIED - this will cause "Sender restricted" errors');
      console.log('\n💡 To verify:');
      console.log(`   node check-and-verify-funding.js`);
    } else {
      console.log(`\n⚠️  Funding source status: ${fundingSource.status}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    rl.close();
    await db.end();
  }
}

checkFundingSource();
