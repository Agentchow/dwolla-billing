#!/usr/bin/env node
/**
 * Debug script to check Zach's funding source
 */

require('dotenv').config({ override: true });
const { Pool } = require('pg');

const db = new Pool({ connectionString: process.env.DATABASE_URL });
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

async function checkZachFundingSource() {
  try {
    // Get Zach's funding source from database
    const result = await db.query(
      'SELECT crm_contact_id, name, dwolla_funding_href FROM customers WHERE crm_contact_id = $1',
      ['zach']
    );

    if (result.rows.length === 0) {
      console.error('❌ Zach not found in database');
      process.exit(1);
    }

    const zach = result.rows[0];
    console.log('🔍 Checking Zach\'s Funding Source...\n');
    console.log('Customer:', zach.name);
    console.log('Funding Source HREF:', zach.dwolla_funding_href);
    console.log('');

    if (!zach.dwolla_funding_href) {
      console.error('❌ Zach has no funding source set');
      process.exit(1);
    }

    const fundingSourceId = zach.dwolla_funding_href.split('/funding-sources/')[1];
    if (!fundingSourceId) {
      console.error('❌ Invalid funding source HREF format');
      process.exit(1);
    }

    console.log('🔐 Getting Dwolla token...');
    const token = await getToken();
    console.log('✅ Token obtained\n');

    console.log('🔍 Checking funding source...');
    const res = await fetch(`${DWOLLA_BASE}/funding-sources/${fundingSourceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.dwolla.v1.hal+json'
      }
    });

    const body = await res.text();
    
    if (!res.ok) {
      console.error(`❌ Funding source check failed (${res.status}):`);
      console.error(body);
      process.exit(1);
    }

    const data = JSON.parse(body);
    console.log('✅ Funding source found!');
    console.log('\n📋 Funding Source Details:');
    console.log('   Name:', data.name || 'N/A');
    console.log('   Type:', data.type || 'N/A');
    console.log('   Status:', data.status || 'N/A');
    console.log('   Bank Name:', data.bankName || 'N/A');
    console.log('   Account Type:', data.accountType || 'N/A');
    
    if (data.status !== 'verified') {
      console.warn('\n⚠️  WARNING: Funding source is not verified!');
      console.warn('   Status:', data.status);
      console.warn('   Transfers will fail if the source is not verified.');
    }

    if (data.removedAt) {
      console.error('\n❌ ERROR: Funding source has been removed!');
      console.error('   Removed At:', data.removedAt);
    }

    await db.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

checkZachFundingSource();

