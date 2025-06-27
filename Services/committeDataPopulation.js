// This script fetches committee, subcommittee, history, and report data from the Congress.gov API
// and populates the corresponding tables in the PostgreSQL database.
// NOTE: This version adds checks to see if report data needs updating, reducing unnecessary API calls.
// To run this script:
// 1. Make sure you have run the latest database setup script first (v3).
// 2. Install packages: npm install pg dotenv node-fetch
// 3. Ensure your .env file is present with DB credentials, CONGRESS_API_KEY, and CURRENT_CONGRESS.
// 4. Run the script from your terminal: node <filename>.js (or <filename>.mjs if using "type": "module")

import { Pool } from 'pg';
import fetch from 'node-fetch';
import 'dotenv/config';

// Configuration for the Congress.gov API and script behavior
const API_KEY = process.env.CONGRESS_API_KEY;
const BASE_API_URL = 'https://api.congress.gov/v3';
const CONGRESS_TO_FETCH = process.env.CURRENT_CONGRESS;
const BATCH_SIZE = 25; // API calls can be heavy, so a smaller batch is safer
const FORCE_UPDATE_REPORTS = true; // Set to true to force update all reports, false to use optimization

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches all committees and subcommittees for a given congress.
 * @returns {Promise<Array<object>>} A promise that resolves to a list of committee objects from the API.
 */
async function fetchAllCommittees() {
  if (!CONGRESS_TO_FETCH) {
    console.error('❌ Error: CURRENT_CONGRESS is not defined in your .env file.');
    return [];
  }
  
  const allCommittees = [];
  let nextUrl = `${BASE_API_URL}/committee/${CONGRESS_TO_FETCH}?api_key=${API_KEY}&limit=250`;
  console.log(`Starting to fetch committees for Congress ${CONGRESS_TO_FETCH}...`);

  while (nextUrl) {
    try {
      const response = await fetch(nextUrl);
      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      const data = await response.json();

      if (data.committees) {
        allCommittees.push(...data.committees);
      }
      
      nextUrl = (data.pagination && data.pagination.next) ? `${data.pagination.next}&api_key=${API_KEY}` : null;
      await sleep(250);
    } catch (error) {
      console.error(`Error fetching committees from ${nextUrl}:`, error);
      nextUrl = null;
    }
  }

  console.log(`✅ Found a total of ${allCommittees.length} committees and subcommittees.`);
  return allCommittees;
}

/**
 * Upserts basic committee info and establishes parent-child relationships.
 * This is done in two passes to ensure parent committees exist before being referenced.
 * @param {Array<object>} committeesData - The raw committee data from the API.
 * @returns {Promise<Array<string>>} A list of detail URLs for all committees.
 */
async function upsertBaseCommittees(committeesData) {
  const client = await pool.connect();
  const detailUrls = [];

  try {
    console.log('Upserting base committee information...');
    await client.query('BEGIN');

    // Pass 1: Insert all committees with NULL for parent.
    for (const committee of committeesData) {
      detailUrls.push(`${committee.url}&api_key=${API_KEY}`);
      const query = {
        text: `
          INSERT INTO committees (system_code, name, chamber, committee_type_code)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (system_code) DO UPDATE SET
            name = EXCLUDED.name,
            chamber = EXCLUDED.chamber,
            committee_type_code = EXCLUDED.committee_type_code;
        `,
        values: [committee.systemCode, committee.name, committee.chamber, committee.committeeTypeCode],
      };
      await client.query(query);
    }

    // Pass 2: Update parent_committee_system_code for subcommittees.
    for (const committee of committeesData) {
        // The API returns an object for parent, not a direct code.
        if (committee.parent && committee.parent.systemCode) {
            const query = {
                text: `UPDATE committees SET parent_committee_system_code = $1 WHERE system_code = $2;`,
                values: [committee.parent.systemCode, committee.systemCode],
            };
            await client.query(query);
        }
    }
    
    await client.query('COMMIT');
    console.log('✅ Base committee information saved.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error saving base committee info, transaction rolled back.', error);
  } finally {
    client.release();
  }
  return detailUrls;
}

/**
 * Fetches committee details and history, and returns URLs for their reports if they have been updated.
 * @param {Array<string>} detailUrls - A batch of committee detail URLs.
 * @returns {Promise<Array<object>>} A list of objects containing committee codes and their report URLs.
 */
async function processCommitteeDetailsBatch(detailUrls) {
  const reportUrlData = [];
  const client = await pool.connect();

  try {
      await client.query('BEGIN');
      for (const url of detailUrls) {
          const response = await fetch(url);
          if (!response.ok) {
              console.error(`  Error fetching detail for ${url}: Status ${response.status}`);
              continue;
          }
          const { committee } = await response.json();
          if (!committee) continue;

          // Update committee with `isCurrent` flag and `updateDate`
          await client.query({
              text: 'UPDATE committees SET is_current = $1, updated_at = $2 WHERE system_code = $3',
              values: [committee.isCurrent, committee.updateDate, committee.systemCode]
          });

          // Unpack and save committee history
          if (Array.isArray(committee.history)) {
              for (const historyItem of committee.history) {
                  if (historyItem.officialName) {
                    await client.query({
                        text: `
                            INSERT INTO committee_history (committee_system_code, official_name, start_date, end_date)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT DO NOTHING;
                        `,
                        values: [committee.systemCode, historyItem.officialName, historyItem.startDate, historyItem.endDate]
                    });
                  }
              }
          }

          // Check if reports need to be updated
          if (committee.reports && committee.reports.url) {
              // Check reports specifically for the current congress
              const dbResult = await client.query({
                  text: `
                      SELECT 
                          COUNT(DISTINCT cr.id) as total_reports,
                          COUNT(DISTINCT rab.report_id) as reports_with_bills
                      FROM committee_reports cr
                      INNER JOIN report_committees rc ON cr.id = rc.report_id
                      LEFT JOIN report_associated_bills rab ON cr.id = rab.report_id
                      WHERE rc.committee_system_code = $1 AND cr.congress = $2
                  `,
                  values: [committee.systemCode, parseInt(CONGRESS_TO_FETCH)]
              });
              
              const currentCongressReports = parseInt(dbResult.rows[0].total_reports, 10);
              const reportsWithBills = parseInt(dbResult.rows[0].reports_with_bills, 10);
              const reportsWithoutBills = currentCongressReports - reportsWithBills;

              // Always process if there are reports without bill associations in the current congress
              if (reportsWithoutBills > 0 || committee.reports.count > 0) {
                  if (reportsWithoutBills > 0) {
                      console.log(`  Queueing reports for ${committee.systemCode}: ${reportsWithoutBills} Congress ${CONGRESS_TO_FETCH} reports need bill associations.`);
                  } else {
                      console.log(`  Queueing reports for ${committee.systemCode}: Checking for new Congress ${CONGRESS_TO_FETCH} reports.`);
                  }
                  
                  const baseUrl = committee.reports.url;
                  const urlWithKey = baseUrl.includes('?') ? `${baseUrl}&api_key=${API_KEY}` : `${baseUrl}?api_key=${API_KEY}`;
                  reportUrlData.push({
                      systemCode: committee.systemCode,
                      url: urlWithKey
                  });
              } else {
                  console.log(`  Skipping reports for ${committee.systemCode}: No Congress ${CONGRESS_TO_FETCH} reports to process.`);
              }
          }
          await sleep(100); // Small pause between detail fetches
      }
      await client.query('COMMIT');
  } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Error processing committee details batch. Transaction rolled back.`, error);
  } finally {
      client.release();
  }
  return reportUrlData;
}

/**
 * Fetches and saves all reports for a given committee.
 * @param {object} reportUrlDatum - An object containing a committee's systemCode and its reports URL.
 */
async function processCommitteeReports(reportUrlDatum) {
    const client = await pool.connect();
    let nextUrl = reportUrlDatum.url;
    let processedCount = 0;
    let skippedCount = 0;

    try {
        await client.query('BEGIN');
        while (nextUrl) {
            const response = await fetch(nextUrl);
            if (!response.ok) break;
            const data = await response.json();

            if (Array.isArray(data.reports)) {
                for (const report of data.reports) {
                    // Skip reports not from the current congress
                    if (report.congress !== parseInt(CONGRESS_TO_FETCH)) {
                        skippedCount++;
                        continue;
                    }

                    processedCount++;
                    
                    // Insert or update the committee report
                    const res = await client.query({
                        text: `
                            INSERT INTO committee_reports (congress, chamber, type, number, part, citation, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (citation) DO UPDATE SET updated_at = EXCLUDED.updated_at
                            RETURNING id;
                        `,
                        values: [report.congress, report.chamber, report.type, report.number, report.part, report.citation, report.updateDate]
                    });
                    
                    const reportId = res.rows[0].id;
                    
                    // Link report to committee
                    await client.query({
                        text: `
                            INSERT INTO report_committees (report_id, committee_system_code)
                            VALUES ($1, $2) ON CONFLICT DO NOTHING;
                        `,
                        values: [reportId, reportUrlDatum.systemCode]
                    });

                    // Fetch detailed report information to get associated bills
                    if (report.congress && report.type && report.number) {
                        try {
                            // Construct the detail URL
                            const detailUrl = `${BASE_API_URL}/committee-report/${report.congress}/${report.type}/${report.number}?api_key=${API_KEY}`;
                            console.log(`    Fetching detailed report info for ${report.citation} (Congress ${report.congress})...`);
                            
                            const detailResponse = await fetch(detailUrl);
                            if (detailResponse.ok) {
                                const detailData = await detailResponse.json();
                                
                                if (detailData.committeeReports && detailData.committeeReports[0]) {
                                    const detailedReport = detailData.committeeReports[0];
                                    
                                    // Update report with additional details if needed
                                    await client.query({
                                        text: `
                                            UPDATE committee_reports 
                                            SET title = COALESCE($1, title), 
                                                issue_date = COALESCE($2, issue_date),
                                                is_conference_report = COALESCE($3, is_conference_report)
                                            WHERE id = $4;
                                        `,
                                        values: [detailedReport.title, detailedReport.issueDate, detailedReport.isConferenceReport, reportId]
                                    });
                                    
                                    // Process associated bills
                                    if (Array.isArray(detailedReport.associatedBill)) {
                                        for (const associatedBill of detailedReport.associatedBill) {
                                            // First, ensure the bill exists in the bills table
                                            const billRes = await client.query({
                                                text: `
                                                    INSERT INTO bills (congress, type, number)
                                                    VALUES ($1, $2, $3)
                                                    ON CONFLICT (congress, type, number) DO UPDATE SET
                                                        congress = EXCLUDED.congress
                                                    RETURNING id;
                                                `,
                                                values: [associatedBill.congress, associatedBill.type, associatedBill.number]
                                            });
                                            
                                            const billId = billRes.rows[0].id;
                                            
                                            // Create the association between report and bill
                                            await client.query({
                                                text: `
                                                    INSERT INTO report_associated_bills (report_id, bill_id)
                                                    VALUES ($1, $2)
                                                    ON CONFLICT DO NOTHING;
                                                `,
                                                values: [reportId, billId]
                                            });
                                            
                                            console.log(`      Linked report ${report.citation} to bill ${associatedBill.type}${associatedBill.number}`);
                                        }
                                    }
                                }
                            } else if (detailResponse.status === 404) {
                                console.log(`    No detailed info found for report ${report.citation}`);
                            } else {
                                console.error(`    Error fetching detail for report ${report.citation}: Status ${detailResponse.status}`);
                            }
                            
                            await sleep(100); // Small pause between detail fetches
                        } catch (error) {
                            console.error(`    Error processing detailed report for ${report.citation}:`, error.message);
                        }
                    }
                }
            }
            nextUrl = (data.pagination && data.pagination.next) ? `${data.pagination.next}&api_key=${API_KEY}` : null;
            if (nextUrl) await sleep(100);
        }
        await client.query('COMMIT');
        console.log(`  Reports for committee ${reportUrlDatum.systemCode}: Processed ${processedCount} from Congress ${CONGRESS_TO_FETCH}, skipped ${skippedCount} from other congresses.`);
    } catch(error) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Error processing reports for ${reportUrlDatum.systemCode}. Transaction rolled back.`, error)
    } finally {
        client.release();
    }
}


/**
 * Main function to orchestrate the entire data population process.
 */
async function main() {
  console.log('Starting committee data population process...');
  
  // 1. Get all base committee data
  const committeesData = await fetchAllCommittees();
  if (committeesData.length === 0) {
      console.log('No committees found to process.');
      pool.end();
      return;
  }
  
  // 2. Save base data and get detail URLs
  const detailUrls = await upsertBaseCommittees(committeesData);
  const allReportUrls = [];
  
  // 3. Process details and history in batches
  console.log(`\nProcessing details for ${detailUrls.length} committees in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < detailUrls.length; i += BATCH_SIZE) {
    const batchUrls = detailUrls.slice(i, i + BATCH_SIZE);
    console.log(` Processing details batch ${Math.floor(i / BATCH_SIZE) + 1}...`);
    const reportUrls = await processCommitteeDetailsBatch(batchUrls);
    allReportUrls.push(...reportUrls);
    await sleep(500);
  }

  // 4. Process all reports for each committee
  if (allReportUrls.length > 0) {
    console.log(`\nProcessing reports for ${allReportUrls.length} updated committees...`);
    for (let i = 0; i < allReportUrls.length; i++) {
        console.log(` [${i+1}/${allReportUrls.length}] Fetching reports for ${allReportUrls[i].systemCode}`);
        await processCommitteeReports(allReportUrls[i]);
        await sleep(250); // Pause between processing each committee's reports
    }
  } else {
      console.log('\nNo committee reports needed to be updated.');
  }


  console.log('\n✅ All committee data has been processed!');
  await pool.end();
}

main().catch(error => {
  console.error('An unexpected error occurred during the main process:', error);
  pool.end();
});
