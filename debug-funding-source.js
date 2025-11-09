#!/usr/bin/env node
/**
 * Debug script to check funding source validity
 */

require('dotenv').config({ override: true });

const { DWOLLA_BASE, DWOLLA_KEY, DWOLLA_SECRET, DWOLLA_YOUR_FUNDING_HREF } = process.env;

console.log('🔍 Debugging Funding Source...\n');

if (!DWOLLA_YOUR_FUNDING_HREF) {
  console.error('❌ DWOLLA_YOUR_FUNDING_HREF not set in .env');
  process.exit(1);
}

console.log('📍 Your Funding Source HREF:', DWOLLA_YOUR_FUNDING_HREF);

// Extract funding source ID
const fundingSourceId = DWOLLA_YOUR_FUNDING_HREF.split('/funding-sources/')[1];
if (!fundingSourceId) {
  console.error('❌ Invalid funding source HREF format');
  process.exit(1);
}

console.log('🔑 Funding Source ID:', fundingSourceId);
console.log('');

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
      
      if (res.status === 404) {
        console.error('\n💡 This funding source does not exist or is not accessible with your API key.');
        console.error('   Make sure:');
        console.error('   1. The funding source ID is correct');
        console.error('   2. The funding source belongs to your Dwolla account');
        console.error('   3. You\'re using the correct API key/secret');
      }
      
      return false;
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
      console.warn('   Transfers may fail if the source is not verified.');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

(async () => {
  const isValid = await checkFundingSource();
  if (!isValid) {
    console.log('\n💡 Next steps:');
    console.log('   1. Go to Dwolla Dashboard → Funding Sources');
    console.log('   2. Find your verified funding source');
    console.log('   3. Copy the full Funding Source HREF');
    console.log('   4. Update DWOLLA_YOUR_FUNDING_HREF in your .env file');
    process.exit(1);
  }
})();

