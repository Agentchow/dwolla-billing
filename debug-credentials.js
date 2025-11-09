#!/usr/bin/env node
/**
 * Debug script to check Dwolla credentials
 * 
 * Usage:
 *   node debug-credentials.js
 */

require('dotenv').config({ override: true });

const { DWOLLA_BASE, DWOLLA_KEY, DWOLLA_SECRET } = process.env;

console.log('🔍 Debugging Dwolla Credentials...\n');

// Check if variables exist
console.log('1️⃣  Checking environment variables...');
if (!DWOLLA_BASE) {
  console.error('   ❌ DWOLLA_BASE is missing');
} else {
  console.log('   ✅ DWOLLA_BASE:', DWOLLA_BASE);
}

if (!DWOLLA_KEY) {
  console.error('   ❌ DWOLLA_KEY is missing');
} else {
  console.log('   ✅ DWOLLA_KEY exists:', DWOLLA_KEY.length, 'characters');
  console.log('      First 8 chars:', DWOLLA_KEY.substring(0, 8) + '...');
}

if (!DWOLLA_SECRET) {
  console.error('   ❌ DWOLLA_SECRET is missing');
} else {
  console.log('   ✅ DWOLLA_SECRET exists:', DWOLLA_SECRET.length, 'characters');
  console.log('      First 8 chars:', DWOLLA_SECRET.substring(0, 8) + '...');
}

if (!DWOLLA_KEY || !DWOLLA_SECRET || !DWOLLA_BASE) {
  console.error('\n❌ Missing required environment variables!');
  console.error('   Make sure your .env file has:');
  console.error('   - DWOLLA_BASE=https://api-sandbox.dwolla.com (or production)');
  console.error('   - DWOLLA_KEY=your-key');
  console.error('   - DWOLLA_SECRET=your-secret');
  process.exit(1);
}

console.log('');

// Check for whitespace
console.log('2️⃣  Checking for whitespace issues...');
const keyTrimmed = DWOLLA_KEY.trim();
const secretTrimmed = DWOLLA_SECRET.trim();

if (keyTrimmed !== DWOLLA_KEY) {
  console.warn('   ⚠️  DWOLLA_KEY has leading/trailing whitespace!');
  console.warn('      Original length:', DWOLLA_KEY.length);
  console.warn('      Trimmed length:', keyTrimmed.length);
} else {
  console.log('   ✅ DWOLLA_KEY has no whitespace issues');
}

if (secretTrimmed !== DWOLLA_SECRET) {
  console.warn('   ⚠️  DWOLLA_SECRET has leading/trailing whitespace!');
  console.warn('      Original length:', DWOLLA_SECRET.length);
  console.warn('      Trimmed length:', secretTrimmed.length);
} else {
  console.log('   ✅ DWOLLA_SECRET has no whitespace issues');
}

console.log('');

// Check environment match
console.log('3️⃣  Checking environment match...');
const isSandbox = DWOLLA_BASE.includes('sandbox');
const keyStartsWithSandbox = DWOLLA_KEY.toLowerCase().startsWith('kti') || DWOLLA_KEY.toLowerCase().startsWith('sandbox');
const keyStartsWithProd = DWOLLA_KEY.toLowerCase().startsWith('prod') || DWOLLA_KEY.toLowerCase().startsWith('live');

if (isSandbox && !keyStartsWithSandbox && !keyStartsWithProd) {
  console.warn('   ⚠️  Using sandbox base URL but key might be for production');
  console.warn('      Sandbox keys usually start with specific prefixes');
} else if (!isSandbox && keyStartsWithSandbox) {
  console.warn('   ⚠️  Using production base URL but key might be for sandbox');
} else {
  console.log('   ✅ Environment appears to match');
}

console.log('');

// Test authentication
console.log('4️⃣  Testing authentication...');
async function testAuth() {
  try {
    const creds = Buffer.from(`${keyTrimmed}:${secretTrimmed}`).toString('base64');
    
    console.log('   📤 Making request to:', `${DWOLLA_BASE}/token`);
    console.log('   📋 Authorization header length:', creds.length, 'characters');
    console.log('   📋 First 20 chars of base64:', creds.substring(0, 20) + '...');
    console.log('');
    
    const res = await fetch(`${DWOLLA_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const body = await res.text();

    if (!res.ok) {
      console.error('   ❌ Authentication failed!');
      console.error('   📊 Status:', res.status);
      console.error('   📄 Response:', body);
      console.error('');
      console.error('💡 Common issues:');
      console.error('   1. Wrong API key/secret (double-check they\'re correct)');
      console.error('   2. Wrong environment (sandbox key with production URL or vice versa)');
      console.error('   3. Extra spaces or quotes in .env file');
      console.error('   4. Key/secret copied incorrectly (missing characters)');
      console.error('   5. API key was revoked or deleted');
      console.error('');
      console.error('🔧 Troubleshooting steps:');
      console.error('   1. Go to Dwolla Dashboard → Settings → API Keys');
      console.error('   2. Verify the key/secret are correct');
      console.error('   3. Make sure you\'re using sandbox keys for sandbox, production for production');
      console.error('   4. Check your .env file for any extra spaces or quotes');
      console.error('   5. Try copying the credentials again');
      return false;
    }

    const json = JSON.parse(body);
    console.log('   ✅ Authentication successful!');
    console.log('   📋 Token Type:', json.token_type);
    console.log('   ⏰ Expires In:', json.expires_in, 'seconds');
    return true;
  } catch (error) {
    console.error('   ❌ Error:', error.message);
    if (error.stack) console.error('   Stack:', error.stack);
    return false;
  }
}

testAuth().then(success => {
  if (success) {
    console.log('\n✅ All checks passed! Your credentials are working.');
  } else {
    console.log('\n❌ Credentials check failed. See errors above.');
    process.exit(1);
  }
});

