#!/usr/bin/env node
/**
 * Debug Dwolla OAuth credentials and endpoint.
 * - Normalizes DWOLLA_BASE (removes trailing slash)
 * - Tries token on DWOLLA_BASE
 * - If 401, also tries the opposite environment (sandbox vs prod)
 */

require('dotenv').config({ override: true });

const rawBase = process.env.DWOLLA_BASE || '';
const base = rawBase.replace(/\/+$/, '');
const key = (process.env.DWOLLA_KEY || '').trim();
const secret = (process.env.DWOLLA_SECRET || '').trim();

if (!key || !secret) {
  console.error('❌ Missing DWOLLA_KEY or DWOLLA_SECRET in environment');
  process.exit(1);
}

function otherBase(current) {
  if (current.includes('api-sandbox.dwolla.com')) return 'https://api.dwolla.com';
  return 'https://api-sandbox.dwolla.com';
}

async function requestToken(targetBase) {
  const creds = Buffer.from(`${key}:${secret}`).toString('base64');
  const url = `${targetBase}/token`;
  console.log(`\n🔐 Requesting token → ${url}`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const text = await res.text();
    console.log('HTTP', res.status);
    console.log('Body:', text);
    return { status: res.status, body: text };
  } catch (e) {
    console.error('❌ Network/Fetch error:', e.message);
    return { status: 0, body: e.message };
  }
}

(async () => {
  console.log('🧪 Dwolla Auth Debug');
  console.log('Base (raw):', rawBase || '(not set)');
  console.log('Base (normalized):', base || '(empty)');
  console.log('Key length:', key.length);
  console.log('Secret length:', secret.length);

  const first = await requestToken(base);
  if (first.status === 200) {
    console.log('\n✅ Success on configured base.');
    process.exit(0);
  }

  console.log('\n⚠️  Failed on configured base, trying opposite environment...');
  const alt = otherBase(base);
  const second = await requestToken(alt);
  if (second.status === 200) {
    console.log('\n✅ Success on opposite environment.');
    console.log('💡 Update DWOLLA_BASE in your .env to:', alt);
    process.exit(0);
  }

  console.log('\n❌ Both environments failed. Verify your key/secret pair and account environment.');
  process.exit(1);
})();


