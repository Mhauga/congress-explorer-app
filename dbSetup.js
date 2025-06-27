// This script sets up the PostgreSQL database for the Congress.gov API data.
// NOTE: v5 - Adds 'direct_order_name' and 'inverted_order_name' to the 'members' table.
// To run this script:
// 1. Add "type": "module" to your package.json file.
// 2. Install packages: npm install pg dotenv
// 3. Run the script from your terminal: node <filename>.js

import { Client } from 'pg';
import 'dotenv/config';

// SQL statements to create the database schema.
const createTablesSQL = `
  -- Drop existing tables in reverse order of creation to avoid foreign key errors
  DROP TABLE IF EXISTS bill_text_versions, bill_subjects, bill_titles, report_associated_bills, report_committees, committee_reports, laws, related_bills, bill_summaries, cbo_cost_estimates, bill_action_committees, bill_actions, bill_cosponsors, bill_committees, bills, committee_history, committees, member_party_history, member_addresses, member_leadership, member_terms, members CASCADE;

  -- ========= MEMBERS =========

  CREATE TABLE members (
      bioguide_id TEXT PRIMARY KEY,
      direct_order_name TEXT,
      inverted_order_name TEXT,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      suffix_name TEXT,
      nickname TEXT,
      honorific_name TEXT,
      birth_year INT,
      death_year INT,
      official_url TEXT,
      depiction_image_url TEXT,
      depiction_attribution TEXT,
      is_current_member BOOLEAN,
      updated_at TIMESTAMPTZ
  );

  CREATE TABLE member_addresses (
      id SERIAL PRIMARY KEY,
      member_bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
      office_address TEXT,
      city TEXT,
      district TEXT,
      zip_code TEXT,
      phone_number TEXT,
      UNIQUE (member_bioguide_id)
  );

  CREATE TABLE member_party_history (
      id SERIAL PRIMARY KEY,
      member_bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
      party_name TEXT NOT NULL,
      party_abbreviation TEXT,
      start_year INT NOT NULL,
      UNIQUE (member_bioguide_id, party_name, start_year)
  );

  CREATE TABLE member_terms (
      id SERIAL PRIMARY KEY,
      member_bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
      congress INT NOT NULL,
      chamber TEXT NOT NULL,
      member_type TEXT,
      state_code TEXT NOT NULL,
      state_name TEXT,
      district INT,
      start_year INT,
      end_year INT,
      UNIQUE (member_bioguide_id, congress, chamber, district)
  );

  CREATE TABLE member_leadership (
      id SERIAL PRIMARY KEY,
      member_bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
      congress INT NOT NULL,
      leadership_type TEXT NOT NULL,
      is_current BOOLEAN,
      UNIQUE(member_bioguide_id, congress, leadership_type)
  );

  -- ========= COMMITTEES =========

  CREATE TABLE committees (
      system_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      chamber TEXT NOT NULL,
      committee_type_code TEXT,
      parent_committee_system_code TEXT REFERENCES committees(system_code) ON DELETE SET NULL,
      is_current BOOLEAN,
      updated_at TIMESTAMPTZ
  );

  CREATE TABLE committee_history (
      id SERIAL PRIMARY KEY,
      committee_system_code TEXT NOT NULL REFERENCES committees(system_code) ON DELETE CASCADE,
      official_name TEXT,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      establishing_authority TEXT
  );

  -- ========= BILLS =========

  CREATE TABLE bills (
      id SERIAL PRIMARY KEY,
      congress INT NOT NULL,
      type TEXT NOT NULL,
      number INT NOT NULL,
      origin_chamber TEXT,
      title TEXT,
      introduced_date DATE,
      policy_area_name TEXT,
      sponsor_bioguide_id TEXT REFERENCES members(bioguide_id) ON DELETE SET NULL,
      is_by_request BOOLEAN,
      constitutional_authority_statement_text TEXT,
      updated_at TIMESTAMPTZ,
      updated_at_including_text TIMESTAMPTZ,
      last_processed_at TIMESTAMPTZ, -- ADDED: Tracks when the script last processed this bill.
      UNIQUE (congress, type, number)
  );
  
  CREATE TABLE bill_cosponsors (
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      member_bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
      sponsorship_date DATE NOT NULL,
      is_original_cosponsor BOOLEAN NOT NULL,
      sponsorship_withdrawn_date DATE,
      PRIMARY KEY (bill_id, member_bioguide_id)
  );

  CREATE TABLE bill_actions (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      action_date TIMESTAMPTZ NOT NULL,
      text TEXT NOT NULL,
      type TEXT,
      action_code TEXT,
      source_system_name TEXT,
      UNIQUE(bill_id, action_date, text)
  );

  CREATE TABLE bill_action_committees (
      action_id INT NOT NULL REFERENCES bill_actions(id) ON DELETE CASCADE,
      committee_system_code TEXT NOT NULL REFERENCES committees(system_code) ON DELETE CASCADE,
      PRIMARY KEY (action_id, committee_system_code)
  );

  CREATE TABLE bill_committees (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      committee_system_code TEXT NOT NULL REFERENCES committees(system_code) ON DELETE CASCADE,
      activity_name TEXT NOT NULL,
      activity_date TIMESTAMPTZ,
      UNIQUE(bill_id, committee_system_code, activity_name, activity_date)
  );

  CREATE TABLE cbo_cost_estimates (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      url TEXT UNIQUE,
      title TEXT,
      description TEXT,
      publication_date TIMESTAMPTZ
  );

  CREATE TABLE bill_summaries (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      version_code TEXT,
      action_description TEXT,
      action_date DATE,
      text TEXT,
      updated_at TIMESTAMPTZ,
      UNIQUE(bill_id, version_code, action_date)
  );

  -- NEW: Table for legislative subjects assigned to a bill.
  CREATE TABLE bill_subjects (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE (bill_id, name)
  );

  -- NEW: Table for the various titles a bill can have.
  CREATE TABLE bill_titles (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      title_type TEXT,
      title TEXT,
      chamber_code TEXT,
      chamber_name TEXT,
      UNIQUE(bill_id, title_type, title)
  );

  -- NEW: Table for the different text versions of a bill.
  CREATE TABLE bill_text_versions (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      date TIMESTAMPTZ,
      url TEXT,
      format TEXT,
      UNIQUE(bill_id, type, format)
  );

  CREATE TABLE related_bills (
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      related_bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      identified_by TEXT NOT NULL,
      PRIMARY KEY (bill_id, related_bill_id, identified_by)
  );

  CREATE TABLE laws (
      bill_id INT PRIMARY KEY REFERENCES bills(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      number TEXT NOT NULL
  );
  
  -- ========= COMMITTEE REPORTS =========
  
  CREATE TABLE committee_reports (
      id SERIAL PRIMARY KEY,
      congress INT NOT NULL,
      chamber TEXT NOT NULL,
      type TEXT NOT NULL,
      number INT NOT NULL,
      part INT,
      citation TEXT UNIQUE,
      title TEXT,
      issue_date TIMESTAMPTZ,
      is_conference_report BOOLEAN,
      updated_at TIMESTAMPTZ,
      UNIQUE (congress, type, number, part)
  );

  CREATE TABLE report_committees (
      report_id INT NOT NULL REFERENCES committee_reports(id) ON DELETE CASCADE,
      committee_system_code TEXT NOT NULL REFERENCES committees(system_code) ON DELETE CASCADE,
      PRIMARY KEY (report_id, committee_system_code)
  );

  CREATE TABLE report_associated_bills (
      report_id INT NOT NULL REFERENCES committee_reports(id) ON DELETE CASCADE,
      bill_id INT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      PRIMARY KEY (report_id, bill_id)
  );
`;

const setupDatabase = async () => {
  const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  try {
    await client.connect();
    console.log('Successfully connected to the database.');
    console.log('Dropping existing tables and creating new schema...');
    await client.query(createTablesSQL);
    console.log('✅ Database schema created successfully!');
  } catch (err) {
    console.error('❌ Error setting up the database:', err.stack);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
};

setupDatabase();