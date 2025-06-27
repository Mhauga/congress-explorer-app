// This script fetches comprehensive bill data from the Congress.gov API and populates the database.
// It handles the main bill details and all related sub-endpoints like actions, committees, and summaries.
// NOTE: This version fixes a bug that created invalid URLs and handles missing chamber data.
// To run this script:
// 1. Run the latest database setup script (v4) first.
// 2. Install packages: npm install pg dotenv node-fetch
// 3. Ensure your .env file has DB credentials, CONGRESS_API_KEY, and CURRENT_CONGRESS.
// 4. Run the script: node <filename>.js

import { Pool } from 'pg';
import fetch from 'node-fetch';
import 'dotenv/config';

const API_KEY = process.env.CONGRESS_API_KEY;
const BASE_API_URL = 'https://api.congress.gov/v3';
const CONGRESS_TO_FETCH = process.env.CURRENT_CONGRESS;
const BATCH_SIZE = 15; // Bills are very heavy, use a small batch size

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Infers the chamber from committee system code or name when not provided
 */
function inferChamber(committee) {
    if (committee.chamber) return committee.chamber;
    
    const systemCode = committee.systemCode?.toLowerCase() || '';
    const name = committee.name?.toLowerCase() || '';
    
    // Common patterns for identifying chambers
    if (systemCode.startsWith('s') || systemCode.startsWith('ss')) return 'Senate';
    if (systemCode.startsWith('h') || systemCode.startsWith('hs')) return 'House';
    if (systemCode.includes('jt') || name.includes('joint')) return 'Joint';
    
    // Specific known committees
    if (name.includes('senate') || name.includes('foreign relations')) return 'Senate';
    if (name.includes('house') || name.includes('representatives')) return 'House';
    
    // Log when we have to infer
    if (!committee.chamber) {
        console.log(`    Chamber inferred as '${inferChamber(committee)}' for committee: ${committee.name} (${committee.systemCode})`);
    }
    
    // Default to 'Unknown' if we can't determine
    return 'Unknown';
}

/**
 * Fetches all bill URLs for the specified congress, filtering out recently processed bills.
 */
async function fetchAndFilterBillUrls() {
  if (!CONGRESS_TO_FETCH) {
    console.error('❌ Error: CURRENT_CONGRESS is not defined in your .env file.');
    return [];
  }
  const billUrlsToProcess = [];
  const client = await pool.connect();
  let nextUrl = `${BASE_API_URL}/bill/${CONGRESS_TO_FETCH}?api_key=${API_KEY}&limit=250`;
  console.log(`Starting to fetch and filter bill URLs for Congress ${CONGRESS_TO_FETCH}...`);

  try {
    while (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      const data = await response.json();
      const apiBills = data.bills;

      if (apiBills && apiBills.length > 0) {
        // Get identifiers for the current page of bills
        const identifiers = apiBills.map(b => `(${b.congress}, '${b.type.replace(/'/g, "''")}', ${b.number})`).join(',');
        
        // Query DB for existing bills in this page
        const dbResult = await client.query(`
            SELECT congress, type, number, last_processed_at
            FROM bills
            WHERE (congress, type, number) IN (${identifiers})
        `);

        // Create a map for fast lookup
        const dbBillMap = new Map(dbResult.rows.map(r => [`${r.congress}-${r.type}-${r.number}`, r.last_processed_at]));
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Filter out recently processed bills
        for (const apiBill of apiBills) {
            const key = `${apiBill.congress}-${apiBill.type}-${apiBill.number}`;
            const lastProcessed = dbBillMap.get(key);

            if (lastProcessed && new Date(lastProcessed) > sevenDaysAgo) {
                // This bill was processed recently, so we skip it.
                continue;
            }
            // FIXED: Use '?' to correctly append the API key to the base URL.
            billUrlsToProcess.push(`${apiBill.url}&api_key=${API_KEY}`);
        }
      }
      
      nextUrl = data.pagination?.next ? `${data.pagination.next}&api_key=${API_KEY}` : null;
      await sleep(250);
    }
  } catch (error) {
      console.error(`Error fetching bill URLs:`, error);
  } finally {
      client.release();
  }
  
  console.log(`✅ Found a total of ${billUrlsToProcess.length} bills to process.`);
  return billUrlsToProcess;
}

/**
 * A generic function to fetch data from paginated sub-endpoints (like actions, summaries, etc.).
 */
async function fetchPaginatedSubEndpoint(url) {
    const items = [];
    let nextUrl = url;
    while(nextUrl) {
        try {
            const response = await fetch(`${nextUrl}${nextUrl.includes('?') ? '&' : '?'}api_key=${API_KEY}`);
            if(!response.ok) {
                 if (response.status === 429) {
                    console.warn(`  Rate limit hit for ${nextUrl}. Retrying after 5s...`);
                    await sleep(5000);
                    continue; // Retry the same URL
                }
                break;
            }
            const data = await response.json();
            const key = Object.keys(data).find(k => Array.isArray(data[k]));
            if (key && data[key]) {
                items.push(...data[key]);
            }
            nextUrl = data.pagination?.next;
            if(nextUrl) await sleep(100);
        } catch(error) {
            console.error(`Error fetching paginated data from ${nextUrl}:`, error);
            nextUrl = null;
        }
    }
    return items;
}

/**
 * Ensures a committee exists in the database
 */
async function ensureCommitteeExists(client, committee) {
    if (!committee || !committee.systemCode) return;
    
    try {
        await client.query({
            text: `INSERT INTO committees (system_code, name, chamber) 
                   VALUES ($1, $2, $3) 
                   ON CONFLICT (system_code) DO UPDATE SET
                       name = COALESCE(EXCLUDED.name, committees.name),
                       chamber = CASE 
                           WHEN committees.chamber = 'Unknown' THEN EXCLUDED.chamber
                           ELSE committees.chamber
                       END;`,
            values: [committee.systemCode, committee.name || 'Unknown Committee', inferChamber(committee)]
        });
    } catch (error) {
        console.error(`    Error ensuring committee exists: ${committee.systemCode}`, error.message);
    }
}

/**
 * Saves a batch of fetched bill data to the database within a single transaction.
 */
async function saveBillBatchToDb(billDataBatch) {
    if (billDataBatch.length === 0) {
        console.log("  No valid bill data in this batch to save.");
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log(`  Starting database transaction for batch of ${billDataBatch.length} bills...`);

        // Check for and insert missing sponsors before processing bills.
        const sponsorIds = [...new Set(billDataBatch.map(b => b.sponsors?.[0]?.bioguideId).filter(id => id))];
        if (sponsorIds.length > 0) {
            const existingSponsorsResult = await client.query(`SELECT bioguide_id FROM members WHERE bioguide_id = ANY($1::TEXT[])`, [sponsorIds]);
            const existingSponsorIds = new Set(existingSponsorsResult.rows.map(r => r.bioguide_id));
            const missingSponsorIds = sponsorIds.filter(id => !existingSponsorIds.has(id));

            if (missingSponsorIds.length > 0) {
                console.log(`    Fetching missing sponsor data for: ${missingSponsorIds.join(', ')}`);
                for (const sponsorId of missingSponsorIds) {
                    const res = await fetch(`${BASE_API_URL}/member/${sponsorId}?api_key=${API_KEY}`);
                    if (res.ok) {
                        const { member } = await res.json();
                        if (member) {
                            await client.query({
                                text: `INSERT INTO members (bioguide_id, first_name, last_name, is_current_member, updated_at) 
                                       VALUES ($1, $2, $3, $4, $5) 
                                       ON CONFLICT DO NOTHING;`,
                                values: [
                                    member.bioguideId, 
                                    member.firstName || 'Unknown', 
                                    member.lastName || 'Unknown', 
                                    member.currentMember, 
                                    member.updateDate
                                ]
                            });
                        }
                    }
                    await sleep(100);
                }
            }
        }

        for (const bill of billDataBatch) {
             // 1. Upsert core bill info and get its ID
            const sponsorId = bill.sponsors && bill.sponsors.length > 0 ? bill.sponsors[0].bioguideId : null;
            const billRes = await client.query({
                text: `INSERT INTO bills (congress, type, number, origin_chamber, title, introduced_date, policy_area_name, sponsor_bioguide_id, is_by_request, constitutional_authority_statement_text, updated_at, updated_at_including_text, last_processed_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                    ON CONFLICT (congress, type, number) DO UPDATE SET
                        origin_chamber = EXCLUDED.origin_chamber, title = EXCLUDED.title, introduced_date = EXCLUDED.introduced_date, policy_area_name = EXCLUDED.policy_area_name,
                        sponsor_bioguide_id = EXCLUDED.sponsor_bioguide_id, is_by_request = EXCLUDED.is_by_request, constitutional_authority_statement_text = EXCLUDED.constitutional_authority_statement_text,
                        updated_at = EXCLUDED.updated_at, updated_at_including_text = EXCLUDED.updated_at_including_text, last_processed_at = NOW()
                    RETURNING id;`,
                values: [
                    bill.congress, 
                    bill.type, 
                    bill.number, 
                    bill.originChamber, 
                    bill.title || 'Untitled Bill', 
                    bill.introducedDate, 
                    bill.policyArea?.name, 
                    sponsorId, 
                    bill.sponsors?.[0]?.isByRequest === 'Y', 
                    bill.constitutionalAuthorityStatementText, 
                    bill.updateDate, 
                    bill.updateDateIncludingText
                ]
            });
            const billId = billRes.rows[0].id;
            
            // 2. Process related data from sub-endpoints
            if (bill.actions?.url) {
                const actions = await fetchPaginatedSubEndpoint(bill.actions.url);
                for (const action of actions) {
                    const actionRes = await client.query({ 
                        text: `INSERT INTO bill_actions (bill_id, action_date, text, type, action_code, source_system_name) 
                               VALUES ($1, $2, $3, $4, $5, $6) 
                               ON CONFLICT (bill_id, action_date, text) DO UPDATE SET type = EXCLUDED.type
                               RETURNING id;`, 
                        values: [
                            billId, 
                            action.actionDate, 
                            action.text || 'No description', 
                            action.type, 
                            action.actionCode, 
                            action.sourceSystem?.name
                        ] 
                    });

                    if (actionRes.rows.length > 0) {
                        const actionId = actionRes.rows[0].id;
                        if (Array.isArray(action.committees)) {
                            for (const committee of action.committees) {
                                // Ensure committee exists before linking
                                await ensureCommitteeExists(client, committee);
                                
                                // Create the link in the junction table
                                if (committee.systemCode) {
                                    await client.query({
                                        text: `INSERT INTO bill_action_committees (action_id, committee_system_code) 
                                               VALUES ($1, $2) 
                                               ON CONFLICT DO NOTHING;`,
                                        values: [actionId, committee.systemCode]
                                    });
                                }
                            }
                        }
                    }
                }
            }
            
            if (bill.committees?.url) {
                const committees = await fetchPaginatedSubEndpoint(bill.committees.url);
                for (const committee of committees) {
                    // Ensure the committee exists first
                    await ensureCommitteeExists(client, committee);
                    
                    // Check if activities exists and is an array
                    if (Array.isArray(committee.activities)) {
                        for (const activity of committee.activities) {
                            await client.query({ 
                                text: `INSERT INTO bill_committees (bill_id, committee_system_code, activity_name, activity_date) 
                                       VALUES ($1, $2, $3, $4) 
                                       ON CONFLICT(bill_id, committee_system_code, activity_name, activity_date) DO NOTHING;`, 
                                values: [billId, committee.systemCode, activity.name, activity.date]
                            });
                        }
                    }
                }
            }

            if (bill.cosponsors?.url) {
                const cosponsors = await fetchPaginatedSubEndpoint(bill.cosponsors.url);
                const cosponsorIds = cosponsors.map(c => c.bioguideId).filter(id => id);
                if (cosponsorIds.length > 0) {
                    const existingCosponsorsResult = await client.query(`SELECT bioguide_id FROM members WHERE bioguide_id = ANY($1::TEXT[])`, [cosponsorIds]);
                    const existingCosponsorIds = new Set(existingCosponsorsResult.rows.map(r => r.bioguide_id));
                    const missingCosponsorIds = cosponsorIds.filter(id => !existingCosponsorIds.has(id));

                    if (missingCosponsorIds.length > 0) {
                        console.log(`    Fetching missing cosponsor data for: ${missingCosponsorIds.join(', ')}`);
                        for (const cosponsorId of missingCosponsorIds) {
                            const res = await fetch(`${BASE_API_URL}/member/${cosponsorId}?api_key=${API_KEY}`);
                            if (res.ok) {
                                const { member } = await res.json();
                                if (member) {
                                    await client.query({
                                        text: `INSERT INTO members (bioguide_id, first_name, last_name, is_current_member, updated_at) 
                                               VALUES ($1, $2, $3, $4, $5) 
                                               ON CONFLICT DO NOTHING;`, 
                                        values: [
                                            member.bioguideId, 
                                            member.firstName || 'Unknown', 
                                            member.lastName || 'Unknown', 
                                            member.currentMember, 
                                            member.updateDate
                                        ]
                                    });
                                }
                            }
                            await sleep(100);
                        }
                    }
                }
                for (const cosponsor of cosponsors) {
                    if (cosponsor.bioguideId) {
                        await client.query({ 
                            text: `INSERT INTO bill_cosponsors (bill_id, member_bioguide_id, sponsorship_date, is_original_cosponsor, sponsorship_withdrawn_date) 
                                   VALUES ($1, $2, $3, $4, $5) 
                                   ON CONFLICT DO NOTHING;`, 
                            values: [billId, cosponsor.bioguideId, cosponsor.sponsorshipDate, cosponsor.isOriginalCosponsor, cosponsor.sponsorshipWithdrawnDate] 
                        });
                    }
                }
            }

            if (bill.committeeReports) {
                for (const reportStub of bill.committeeReports) {
                    if (!reportStub.url) continue;

                    const reportDetailResponse = await fetch(`${reportStub.url}&api_key=${API_KEY}`);
                    if (!reportDetailResponse.ok) {
                        console.error(`    Could not fetch details for report ${reportStub.citation}`);
                        continue;
                    }
                    const { committeeReport } = await reportDetailResponse.json();
                    
                    if (committeeReport) {
                        const reportRes = await client.query({
                            text: `
                                INSERT INTO committee_reports (congress, chamber, type, number, part, citation, title, issue_date, is_conference_report, updated_at)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                                ON CONFLICT (citation) DO UPDATE SET
                                    congress = EXCLUDED.congress, chamber = EXCLUDED.chamber, type = EXCLUDED.type, number = EXCLUDED.number, part = EXCLUDED.part,
                                    title = EXCLUDED.title, issue_date = EXCLUDED.issue_date, is_conference_report = EXCLUDED.is_conference_report, updated_at = EXCLUDED.updated_at
                                RETURNING id;
                            `,
                            values: [
                                committeeReport.congress, 
                                committeeReport.chamber || 'Unknown', 
                                committeeReport.type, 
                                committeeReport.number, 
                                committeeReport.part, 
                                committeeReport.citation, 
                                committeeReport.title || 'Untitled Report', 
                                committeeReport.issueDate, 
                                committeeReport.isConferenceReport, 
                                committeeReport.updateDate
                            ]
                        });
                        const reportId = reportRes.rows[0].id;

                        await client.query({
                            text: `INSERT INTO report_associated_bills (bill_id, report_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
                            values: [billId, reportId]
                        });
                        await sleep(100);
                    }
                }
            }
            
            if (bill.relatedBills?.url) {
                const relatedBills = await fetchPaginatedSubEndpoint(bill.relatedBills.url);
                for (const relatedBill of relatedBills) {
                    // Ensure the related bill exists in the bills table to get its ID
                    const relatedBillRes = await client.query({
                        text: `INSERT INTO bills (congress, type, number, title) VALUES ($1, $2, $3, $4)
                               ON CONFLICT (congress, type, number) DO UPDATE SET title = EXCLUDED.title 
                               RETURNING id;`,
                        values: [
                            relatedBill.congress, 
                            relatedBill.type, 
                            relatedBill.number, 
                            relatedBill.title || 'Untitled Bill'
                        ]
                    });
                    const relatedBillId = relatedBillRes.rows[0].id;
                    
                    // Link the two bills in the junction table
                    if (Array.isArray(relatedBill.relationshipDetails)) {
                        for (const relationship of relatedBill.relationshipDetails) {
                             await client.query({
                                text: `INSERT INTO related_bills (bill_id, related_bill_id, relationship_type, identified_by)
                                       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING;`,
                                values: [billId, relatedBillId, relationship.type, relationship.identifiedBy]
                            });
                        }
                    }
                }
            }

            if (bill.summaries?.url) {
                const summaries = await fetchPaginatedSubEndpoint(bill.summaries.url);
                for (const summary of summaries) {
                    await client.query({ 
                        text: `INSERT INTO bill_summaries (bill_id, version_code, action_description, action_date, text, updated_at) 
                               VALUES ($1, $2, $3, $4, $5, $6) 
                               ON CONFLICT (bill_id, version_code, action_date) DO NOTHING;`, 
                        values: [billId, summary.versionCode, summary.actionDesc, summary.actionDate, summary.text, summary.updateDate] 
                    });
                }
            }
            
            if (bill.subjects?.url) {
                const subjectsData = await fetchPaginatedSubEndpoint(bill.subjects.url);
                if(subjectsData.length > 0 && subjectsData[0].legislativeSubjects){
                    for (const subject of subjectsData[0].legislativeSubjects) {
                        await client.query({ 
                            text: `INSERT INTO bill_subjects (bill_id, name) VALUES ($1, $2) ON CONFLICT (bill_id, name) DO NOTHING;`, 
                            values: [billId, subject.name] 
                        });
                    }
                }
            }
            
            if (bill.titles?.url) {
                const titles = await fetchPaginatedSubEndpoint(bill.titles.url);
                for (const title of titles) {
                    await client.query({ 
                        text: `INSERT INTO bill_titles (bill_id, title_type, title, chamber_code, chamber_name) 
                               VALUES ($1, $2, $3, $4, $5) 
                               ON CONFLICT (bill_id, title_type, title) DO NOTHING;`, 
                        values: [billId, title.titleType, title.title, title.chamberCode, title.chamberName] 
                    });
                }
            }

            if (bill.textVersions?.url) {
                const texts = await fetchPaginatedSubEndpoint(bill.textVersions.url);
                for (const text of texts) {
                    if (Array.isArray(text.formats)) {
                        for (const format of text.formats) {
                            await client.query({ 
                                text: `INSERT INTO bill_text_versions (bill_id, type, date, url, format) 
                                       VALUES ($1, $2, $3, $4, $5) 
                                       ON CONFLICT (bill_id, type, format) DO NOTHING;`, 
                                values: [billId, text.type, text.date, format.url, format.type] 
                            });
                        }
                    }
                }
            }

            // Process inline arrays
            if (Array.isArray(bill.cboCostEstimates)) {
                for (const cbo of bill.cboCostEstimates) {
                    await client.query({ 
                        text: `INSERT INTO cbo_cost_estimates (bill_id, url, title, description, publication_date) 
                               VALUES ($1, $2, $3, $4, $5) 
                               ON CONFLICT(url) DO UPDATE SET title=EXCLUDED.title;`, 
                        values: [billId, cbo.url, cbo.title, cbo.description, cbo.pubDate] 
                    });
                }
            }
        }
        
        await client.query('COMMIT');
        console.log(`  ✅ Successfully committed batch to database.`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Error during database batch operation. Transaction rolled back.`, error);
    } finally {
        client.release();
    }
}

/**
 * Main function to orchestrate the entire data population process.
 */
async function main() {
  console.log('Starting bill data population process...');
  const billUrls = await fetchAndFilterBillUrls();
  
  if (billUrls.length === 0) {
    console.log('No new or updated bills found to process.');
    await pool.end();
    return;
  }

  console.log(`\nProcessing ${billUrls.length} bills in batches of ${BATCH_SIZE}. This is a heavy process and will take a long time...`);

  for (let i = 0; i < billUrls.length; i += BATCH_SIZE) {
      const batchUrls = billUrls.slice(i, i + BATCH_SIZE);
      console.log(`\n--- Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(billUrls.length / BATCH_SIZE)} ---`);
      
      // Step 1: Fetch all data for the batch concurrently
      const promises = batchUrls.map(async (url) => {
          try {
              const response = await fetch(url);
              if (!response.ok) {
                  if (response.status === 429) return 'RATE_LIMIT';
                  console.error(`  Error fetching bill detail for ${url}: Status ${response.status}`);
                  return null;
              }
              const { bill } = await response.json();
              return bill;
          } catch(e) {
              console.error(`  Network error for ${url}: ${e.message}`);
              return null;
          }
      });
      const results = await Promise.all(promises);
      
      if(results.includes('RATE_LIMIT')) {
          console.log("Rate limit detected. Pausing for 1 hour and 1 second before retrying batch...");
          await sleep(3601000); // 1 hour and 1 second
          i -= BATCH_SIZE; // Decrement to retry the current batch
          continue;
      }
      
      // Step 2: Save the fetched data in a single database transaction
      const validBillData = results.filter(bill => bill !== null);
      await saveBillBatchToDb(validBillData);
      
      await sleep(2000); // Pause between batches
  }

  console.log('\n✅ All bill batches have been processed!');
  await pool.end();
}

main().catch(error => {
  console.error('An unexpected error occurred during the main process:', error);
  pool.end();
});