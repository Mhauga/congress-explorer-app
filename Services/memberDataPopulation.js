// This script fetches member data from the Congress.gov API and populates the PostgreSQL database.
// NOTE: v3 - This script is updated to handle 'directOrderName' and 'invertedOrderName'.
// It unpacks the 'terms' and 'leadership' arrays and saves them correctly.
// To run this script:
// 1. Run the latest database setup script (v5) first.
// 2. Install packages: npm install pg dotenv node-fetch
// 3. Ensure your .env file is present with DB credentials, CONGRESS_API_KEY, and CURRENT_CONGRESS.
// 4. Run the script from your terminal: node <filename>.js (or <filename>.mjs if using "type": "module")

import { Pool } from 'pg';
import fetch from 'node-fetch';
import 'dotenv/config';

const API_KEY = process.env.CONGRESS_API_KEY;
const BASE_API_URL = 'https://api.congress.gov/v3';
const CONGRESS_TO_FETCH = process.env.CURRENT_CONGRESS;
const BATCH_SIZE = 50;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAllMemberUrls() {
  if (!CONGRESS_TO_FETCH) {
    console.error('❌ Error: CURRENT_CONGRESS is not defined in your .env file.');
    return [];
  }

  const memberUrls = [];
  let nextUrl = `${BASE_API_URL}/member/congress/${CONGRESS_TO_FETCH}?api_key=${API_KEY}&limit=250`;
  let pageNum = 1;

  console.log(`Starting to fetch member URLs for Congress ${CONGRESS_TO_FETCH}...`);

  while (nextUrl) {
    try {
      console.log(`Fetching page ${pageNum}...`);
      const response = await fetch(nextUrl);
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
      }
      const data = await response.json();
      
      if (data.members) {
        data.members.forEach(member => memberUrls.push(`${member.url}&api_key=${API_KEY}`));
      }

      nextUrl = (data.pagination && data.pagination.next) ? `${data.pagination.next}&api_key=${API_KEY}` : null;
      if(nextUrl) pageNum++;
      
      await sleep(200);

    } catch (error) {
      console.error(`Error fetching page ${pageNum} from ${nextUrl}:`, error);
      nextUrl = null;
    }
  }
  console.log(`✅ Found a total of ${memberUrls.length} members for Congress ${CONGRESS_TO_FETCH}.`);
  return memberUrls;
}

async function processMemberBatch(membersData) {
    if (membersData.length === 0) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const member of membersData) {
            // 1. Upsert the main member data
            await client.query({
                text: `
                  INSERT INTO members (
                    bioguide_id, direct_order_name, inverted_order_name, first_name, middle_name, last_name, suffix_name,
                    nickname, honorific_name, birth_year, death_year, official_url, depiction_image_url,
                    depiction_attribution, is_current_member, updated_at
                  )
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                  ON CONFLICT (bioguide_id) DO UPDATE SET
                    direct_order_name = EXCLUDED.direct_order_name,
                    inverted_order_name = EXCLUDED.inverted_order_name,
                    first_name = EXCLUDED.first_name,
                    middle_name = EXCLUDED.middle_name,
                    last_name = EXCLUDED.last_name,
                    suffix_name = EXCLUDED.suffix_name,
                    nickname = EXCLUDED.nickname,
                    honorific_name = EXCLUDED.honorific_name,
                    birth_year = EXCLUDED.birth_year,
                    death_year = EXCLUDED.death_year,
                    official_url = EXCLUDED.official_url,
                    depiction_image_url = EXCLUDED.depiction_image_url,
                    depiction_attribution = EXCLUDED.depiction_attribution,
                    is_current_member = EXCLUDED.is_current_member,
                    updated_at = EXCLUDED.updated_at;
                `,
                values: [
                  member.bioguideId,
                  member.directOrderName,
                  member.invertedOrderName,
                  member.firstName,
                  member.middleName,
                  member.lastName,
                  member.suffixName,
                  member.nickName,
                  member.honorificName,
                  member.birthYear,
                  member.deathYear,
                  member.officialWebsiteUrl,
                  member.depiction?.imageUrl,
                  member.depiction?.attribution,
                  member.currentMember,
                  member.updateDate
                ],
            });

            // 2. Upsert address information
            if (member.addressInformation) {
                const addr = member.addressInformation;
                await client.query({
                    text: `
                      INSERT INTO member_addresses (member_bioguide_id, office_address, city, district, zip_code, phone_number)
                      VALUES ($1, $2, $3, $4, $5, $6)
                      ON CONFLICT (member_bioguide_id) DO UPDATE SET
                        office_address = EXCLUDED.office_address, city = EXCLUDED.city, district = EXCLUDED.district,
                        zip_code = EXCLUDED.zip_code, phone_number = EXCLUDED.phone_number;
                    `,
                    values: [member.bioguideId, addr.officeAddress, addr.city, addr.district, addr.zipCode, addr.phoneNumber]
                });
            }

            // 3. Unpack and upsert party history
            if (Array.isArray(member.partyHistory)) {
                for (const party of member.partyHistory) {
                    await client.query({
                        text: `
                          INSERT INTO member_party_history (member_bioguide_id, party_name, party_abbreviation, start_year)
                          VALUES ($1, $2, $3, $4)
                          ON CONFLICT (member_bioguide_id, party_name, start_year) DO NOTHING;
                        `,
                        values: [member.bioguideId, party.partyName, party.partyAbbreviation, party.startYear]
                    });
                }
            }

            // 4. Unpack and upsert terms
            if (Array.isArray(member.terms)) {
                for (const term of member.terms) {
                    await client.query({
                        text: `
                          INSERT INTO member_terms (member_bioguide_id, congress, chamber, member_type, state_code, state_name, district, start_year, end_year)
                          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                          ON CONFLICT (member_bioguide_id, congress, chamber, district) DO UPDATE SET
                            member_type = EXCLUDED.member_type, state_code = EXCLUDED.state_code, state_name = EXCLUDED.state_name,
                            start_year = EXCLUDED.start_year, end_year = EXCLUDED.end_year;
                        `,
                        values: [member.bioguideId, term.congress, term.chamber, term.memberType, term.stateCode, term.stateName, term.district, term.startYear, term.endYear]
                    });
                }
            }
            
            // 5. Unpack and upsert leadership roles
            if (Array.isArray(member.leadership)) {
                for (const role of member.leadership) {
                    await client.query({
                        text: `
                          INSERT INTO member_leadership (member_bioguide_id, congress, leadership_type, is_current)
                          VALUES ($1, $2, $3, $4)
                          ON CONFLICT (member_bioguide_id, congress, leadership_type) DO UPDATE SET
                            is_current = EXCLUDED.is_current;
                        `,
                        values: [member.bioguideId, role.congress, role.type, role.current]
                    });
                }
            }
        }

        await client.query('COMMIT');
        console.log(`  ✅ Successfully committed batch of ${membersData.length} members.`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Error processing batch for members [${membersData.map(m=>m.bioguideId).join(', ')}]. Transaction rolled back.`, error);
    } finally {
        client.release();
    }
}

async function main() {
  console.log('Starting member data population process...');
  const allMemberUrls = await fetchAllMemberUrls();
  
  if (allMemberUrls.length > 0) {
    console.log(`\nNow processing ${allMemberUrls.length} members in batches of ${BATCH_SIZE}. This may take a while...`);
    
    for (let i = 0; i < allMemberUrls.length; i += BATCH_SIZE) {
        const batchUrls = allMemberUrls.slice(i, i + BATCH_SIZE);
        console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(allMemberUrls.length / BATCH_SIZE)} (Members ${i + 1} to ${i + batchUrls.length})...`);

        const memberPromises = batchUrls.map(async (url) => {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    if (response.status === 429) {
                        console.warn(`  Rate limit hit for ${url}. Will retry this batch...`);
                        return 'RATE_LIMIT';
                    }
                    console.error(`  Error fetching ${url}: Status ${response.status}`);
                    return null;
                }
                const { member } = await response.json();
                return member;
            } catch (error) {
                console.error(`  Network error fetching ${url}:`, error.message);
                return null;
            }
        });

        const results = await Promise.all(memberPromises);
        
        if (results.includes('RATE_LIMIT')) {
            console.log("Pausing for 10 seconds due to rate limit, then retrying last batch...");
            await sleep(10000);
            i -= BATCH_SIZE;
            continue;
        }

        const membersData = results.filter(m => m != null);
        if (membersData.length > 0) {
            await processMemberBatch(membersData);
        }
        await sleep(1000);
    }
    console.log('\n✅ All member batches have been processed!');
  } else {
    console.log('No members found to process.');
  }

  await pool.end();
  console.log('Database connection pool closed.');
}

main().catch(error => {
  console.error('An unexpected error occurred during the main process:', error);
  pool.end();
});