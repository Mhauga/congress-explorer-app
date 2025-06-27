// test-setup.js
// Save this file in your services folder and run: node test-setup.js

import pg from 'pg';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

console.log('🔍 Testing Congressional App Setup...\n');

// Test 1: Database Connection
const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function testDatabase() {
  try {
    console.log('📊 Testing Database Connection...');
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully!\n');

    // Check if tables have data
    const committees = await pool.query('SELECT COUNT(*) FROM committees');
    const bills = await pool.query('SELECT COUNT(*) FROM bills');
    const members = await pool.query('SELECT COUNT(*) FROM members');

    console.log('📈 Database Statistics:');
    console.log(`   - Committees: ${committees.rows[0].count}`);
    console.log(`   - Bills: ${bills.rows[0].count}`);
    console.log(`   - Members: ${members.rows[0].count}\n`);

    if (committees.rows[0].count === '0') {
      console.log('⚠️  WARNING: No committees found! Run committeDataPopulation.js first.');
    }
    if (bills.rows[0].count === '0') {
      console.log('⚠️  WARNING: No bills found! Run billDataPopulation.js first.');
    }
    if (members.rows[0].count === '0') {
      console.log('⚠️  WARNING: No members found! Run memberDataPopulation.js first.');
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
}

// Test 2: API Server
async function testAPI() {
  console.log('\n🌐 Testing API Server...');
  
  try {
    const response = await fetch('http://localhost:3001/api/committees');
    if (response.ok) {
      const data = await response.json();
      console.log('✅ API server is running!');
      console.log(`   - Committees endpoint returned ${data.length} items\n`);
    } else {
      console.log('❌ API server responded but with error:', response.status);
    }
  } catch (error) {
    console.log('❌ API server is not running or not accessible');
    console.log('   Run: cd services && node server.js\n');
  }
}

// Test 3: Environment Variables
function testEnv() {
  console.log('🔐 Checking Environment Variables...');
  const required = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length === 0) {
    console.log('✅ All required environment variables are set!\n');
  } else {
    console.log('❌ Missing environment variables:', missing.join(', '));
    console.log('   Make sure your .env file contains all required variables\n');
  }
}

// Run all tests
async function runTests() {
  testEnv();
  await testDatabase();
  await testAPI();
  
  console.log('\n📋 Next Steps:');
  console.log('1. Make sure backend is running: cd services && node server.js');
  console.log('2. Make sure frontend is running: cd congress-frontend && npm start');
  console.log('3. Open http://localhost:3000 in your browser');
  console.log('4. Check browser console (F12) for any errors');
  
  await pool.end();
}

runTests();