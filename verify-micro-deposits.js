#!/usr/bin/env node
/**
 * Verify micro-deposits for a funding source
 * Usage: node verify-micro-deposits.js
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

async function verifyMicroDeposits() {
  try {
    console.log('💰 Verify Micro-Deposits\n');
    
    const fundingSourceId = await question('Funding Source ID: ');
    if (!fundingSourceId) {
      console.error('❌ Funding Source ID is required');
      process.exit(1);
    }

    const amount1 = await question('Amount 1 (e.g., 0.03): ');
    if (!amount1) {
      console.error('❌ Amount 1 is required');
      process.exit(1);
    }

    const amount2 = await question('Amount 2 (e.g., 0.07): ');
    if (!amount2) {
      console.error('❌ Amount 2 is required');
      process.exit(1);
    }

    console.log('\n🔐 Getting Dwolla token...');
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
  } finally {
    rl.close();
  }
}

verifyMicroDeposits();
