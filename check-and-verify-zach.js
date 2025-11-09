#!/usr/bin/env node
/**
 * Check and verify ZACH1's funding source via micro-deposits
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

async function dwollaGet(token, path) {
  const res = await fetch(`${DWOLLA_BASE}/${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.dwolla.v1.hal+json'
    }
  });

  const text = await res.text();
  
  if (!res.ok) {
    throw new Error(`Dwolla API error: ${res.status} - ${text}`);
  }

  return JSON.parse(text);
}

async function dwollaPost(token, url, body) {
  const res = await fetch(url, {
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

  return { status: res.status, body: text };
}

async function verifyZachFundingSource() {
  try {
    // Get ZACH1's funding source from database
    const result = await db.query(
      'SELECT crm_contact_id, name, dwolla_funding_href FROM customers WHERE crm_contact_id = $1',
      ['ZACH1']
    );

    if (result.rows.length === 0) {
      console.error('❌ ZACH1 not found in database');
      process.exit(1);
    }

    const zach = result.rows[0];
    const fundingSourceHref = zach.dwolla_funding_href;
    
    if (!fundingSourceHref) {
      console.error('❌ ZACH1 has no funding source set');
      process.exit(1);
    }

    console.log('🔍 Checking ZACH1\'s Funding Source...\n');
    console.log('Funding Source HREF:', fundingSourceHref);

    const fundingSourceId = fundingSourceHref.split('/funding-sources/')[1];

    console.log('\n🔐 Getting Dwolla token...');
    const token = await getToken();
    console.log('✅ Token obtained\n');

    console.log('📋 Fetching funding source details...');
    const fundingSource = await dwollaGet(token, `funding-sources/${fundingSourceId}`);
    
    console.log('\n✅ Funding Source Details:');
    console.log('   Name:', fundingSource.name);
    console.log('   Type:', fundingSource.type);
    console.log('   Status:', fundingSource.status);
    console.log('   Bank Name:', fundingSource.bankName || 'N/A');
    
    if (fundingSource.status === 'verified') {
      console.log('\n✅ Funding source is already verified!');
      await db.end();
      return;
    }

    if (fundingSource.status === 'unverified') {
      console.log('\n⚠️  Funding source needs verification via micro-deposits.');
      console.log('\n🔧 Initiating micro-deposits...');
      
      try {
        await dwollaPost(token, `${fundingSourceHref}/micro-deposits`, {});
        console.log('✅ Micro-deposits initiated!');
        console.log('\n📝 In SANDBOX, use these test amounts to verify:');
        console.log('   Amount 1: $0.03');
        console.log('   Amount 2: $0.07');
        console.log('\n   To verify, run:');
        console.log(`   node verify-micro-deposits.js ${fundingSourceId} 0.03 0.07\n`);
      } catch (error) {
        if (error.message.includes('already been initiated')) {
          console.log('✅ Micro-deposits already initiated!');
          console.log('\n📝 In SANDBOX, verify with:');
          console.log('   Amount 1: $0.03');
          console.log('   Amount 2: $0.07');
          console.log(`\n   node verify-micro-deposits.js ${fundingSourceId} 0.03 0.07\n`);
        } else {
          throw error;
        }
      }
    } else {
      console.log(`\n⚠️  Unexpected status: ${fundingSource.status}`);
    }

    await db.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    await db.end();
    process.exit(1);
  }
}

verifyZachFundingSource();

