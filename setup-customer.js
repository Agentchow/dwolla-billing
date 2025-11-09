#!/usr/bin/env node
/**
 * Helper script to set up a customer record with Dwolla funding source
 * 
 * Usage:
 *   node setup-customer.js
 * 
 * This will prompt you for:
 * - CRM contact ID (e.g., "ZACH1")
 * - Name
 * - Email
 * - Dwolla funding source HREF
 */

require('dotenv').config();
const readline = require('readline');
const { Pool } = require('pg');

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupCustomer() {
  try {
    console.log('🔧 Customer Setup Tool\n');
    console.log('This will help you set up a customer record with Dwolla funding source.\n');

    // Get customer details
    const crm_contact_id = await question('CRM Contact ID (e.g., ZACH1): ');
    if (!crm_contact_id) {
      console.error('❌ CRM Contact ID is required');
      process.exit(1);
    }

    const name = await question('Name: ');
    if (!name) {
      console.error('❌ Name is required');
      process.exit(1);
    }

    const email = await question('Email: ');
    if (!email) {
      console.error('❌ Email is required');
      process.exit(1);
    }

    console.log('\n📝 Dwolla Funding Source');
    console.log('You need to get the funding source HREF from Dwolla.');
    console.log('It should look like: https://api-sandbox.dwolla.com/funding-sources/abc-123-def\n');
    
    const dwolla_funding_href = await question('Dwolla Funding Source HREF: ');
    if (!dwolla_funding_href) {
      console.error('❌ Dwolla funding source HREF is required');
      process.exit(1);
    }

    // Validate HREF format
    if (!dwolla_funding_href.includes('funding-sources/')) {
      console.warn('⚠️  Warning: Funding source HREF format looks incorrect');
      const confirm = await question('Continue anyway? (y/n): ');
      if (confirm.toLowerCase() !== 'y') {
        process.exit(0);
      }
    }

    // Check if customer exists
    const existing = await db.query(
      'SELECT * FROM customers WHERE crm_contact_id = $1',
      [crm_contact_id]
    );

    if (existing.rows.length > 0) {
      console.log(`\n📋 Customer "${crm_contact_id}" already exists.`);
      console.log('Current values:');
      console.log(`  Name: ${existing.rows[0].name || '(not set)'}`);
      console.log(`  Email: ${existing.rows[0].email || '(not set)'}`);
      console.log(`  Status: ${existing.rows[0].status || '(not set)'}`);
      console.log(`  Funding Source: ${existing.rows[0].dwolla_funding_href || '(not set)'}`);
      
      const update = await question('\nUpdate this customer? (y/n): ');
      if (update.toLowerCase() !== 'y') {
        console.log('Cancelled.');
        process.exit(0);
      }
    }

    // Insert or update customer
    await db.query(
      `INSERT INTO customers (crm_contact_id, name, email, dwolla_funding_href, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (crm_contact_id) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           dwolla_funding_href = EXCLUDED.dwolla_funding_href,
           status = 'active'`,
      [crm_contact_id, name, email, dwolla_funding_href]
    );

    console.log('\n✅ Customer set up successfully!');
    console.log(`\nCustomer Details:`);
    console.log(`  CRM Contact ID: ${crm_contact_id}`);
    console.log(`  Name: ${name}`);
    console.log(`  Email: ${email}`);
    console.log(`  Status: active`);
    console.log(`  Dwolla Funding Source: ${dwolla_funding_href}`);

    // Verify
    const verify = await db.query(
      'SELECT * FROM customers WHERE crm_contact_id = $1',
      [crm_contact_id]
    );

    if (verify.rows.length > 0 && verify.rows[0].status === 'active' && verify.rows[0].dwolla_funding_href) {
      console.log('\n✅ Customer is ready for billing!');
      console.log('\nNext steps:');
      console.log('1. Test the system: npm run dev');
      console.log('2. Simulate a webhook trigger');
      console.log('3. Run billing: npm run bill:week');
    } else {
      console.log('\n⚠️  Warning: Customer record may not be complete');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    rl.close();
    await db.end();
  }
}

setupCustomer();

