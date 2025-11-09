#!/usr/bin/env node
/**
 * Verify micro-deposits for a funding source
 * Usage: node verify-micro-deposits.js <funding-source-id> <amount1> <amount2>
 */

require('dotenv').config({ override: true });

const { DWOLLA_BASE, DWOLLA_KEY, DWOLLA_SECRET } = process.env;

const [,, fundingSourceId, amount1, amount2] = process.argv;

if (!fundingSourceId || !amount1 || !amount2) {
  console.error('❌ Usage: node verify-micro-deposits.js <funding-source-id> <amount1> <amount2>');
  console.error('   Example: node verify-micro-deposits.js abc-123 0.03 0.07');
  process.exit(1);
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

async function verifyMicroDeposits() {
  try {
    console.log('🔐 Getting Dwolla token...');
    const token = await getToken();
    console.log('✅ Token obtained\n');

    console.log('💰 Verifying micro-deposits...');
    console.log('   Funding Source ID:', fundingSourceId);
    console.log('   Amount 1:', `$${amount1}`);
    console.log('   Amount 2:', `$${amount2}`);
    console.log('');

    const res = await fetch(`${DWOLLA_BASE}/funding-sources/${fundingSourceId}/micro-deposits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.dwolla.v1.hal+json',
        Accept: 'application/vnd.dwolla.v1.hal+json'
      },
      body: JSON.stringify({
        amount1: { value: amount1, currency: 'USD' },
        amount2: { value: amount2, currency: 'USD' }
      })
    });

    const text = await res.text();
    
    if (!res.ok) {
      console.error(`❌ Verification failed (${res.status}):`);
      console.error(text);
      process.exit(1);
    }

    console.log('✅ Micro-deposits verified successfully!');
    console.log('\n📋 Funding source is now VERIFIED and can send funds.');
    console.log('\n🎯 You can now run: npm run bill:week\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

verifyMicroDeposits();

