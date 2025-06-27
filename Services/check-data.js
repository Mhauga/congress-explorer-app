// services/check-data.js
// Quick script to check what data is actually in your database

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function checkData() {
  console.log('🔍 Checking database data...\n');

  try {
    // Check committees
    console.log('📋 COMMITTEES:');
    const committees = await pool.query('SELECT * FROM committees LIMIT 5');
    console.log(`Total count: ${(await pool.query('SELECT COUNT(*) FROM committees')).rows[0].count}`);
    console.log('Sample data:', committees.rows);
    
    // Check members
    console.log('\n👥 MEMBERS:');
    const members = await pool.query('SELECT * FROM members LIMIT 5');
    console.log(`Total count: ${(await pool.query('SELECT COUNT(*) FROM members')).rows[0].count}`);
    console.log('Sample data:', members.rows);
    
    // Check member_terms to see what congresses we have
    console.log('\n📅 MEMBER TERMS (Congresses):');
    const congresses = await pool.query('SELECT DISTINCT congress FROM member_terms ORDER BY congress DESC LIMIT 10');
    console.log('Available congresses:', congresses.rows.map(r => r.congress));
    
    // Check bills
    console.log('\n📄 BILLS:');
    const bills = await pool.query('SELECT * FROM bills LIMIT 5');
    console.log(`Total count: ${(await pool.query('SELECT COUNT(*) FROM bills')).rows[0].count}`);
    console.log('Sample data:', bills.rows);
    
    // Check if bills have committees
    console.log('\n🔗 BILL-COMMITTEE CONNECTIONS:');
    const billCommittees = await pool.query('SELECT COUNT(*) FROM bill_committees');
    console.log(`Total bill-committee connections: ${billCommittees.rows[0].count}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkData();