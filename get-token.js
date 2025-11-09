#!/usr/bin/env node
/**
 * Get a new Dwolla token
 * 
 * Usage:
 *   node get-token.js
 */

require('dotenv').config({ override: true });

const { DWOLLA_BASE, DWOLLA_KEY, DWOLLA_SECRET } = process.env;

if (!DWOLLA_KEY || !DWOLLA_SECRET) {
  console.error('❌ Missing DWOLLA_KEY or DWOLLA_SECRET in .env');
  process.exit(1);
}

async function getNewToken() {
  try {
    console.log('🔐 Requesting new Dwolla token...\n');
    
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
      const errorText = await res.text();
      console.error(`❌ Token request failed (${res.status}):`);
      console.error(errorText);
      process.exit(1);
    }

    const json = await res.json();
    
    console.log('✅ New token obtained!\n');
    console.log('📋 Token Details:');
    console.log('   Token Type:', json.token_type);
    console.log('   Expires In:', json.expires_in, 'seconds');
    console.log('   Expires At:', new Date(Date.now() + json.expires_in * 1000).toISOString());
    console.log('\n🔑 Access Token:');
    console.log(json.access_token);
    console.log('\n💡 Note: This token will be cached automatically by the server.');
    console.log('   The server refreshes tokens automatically 60 seconds before expiry.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

getNewToken();

