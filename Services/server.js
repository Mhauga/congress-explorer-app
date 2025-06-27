// services/server.js
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Committees endpoint
app.get('/api/committees', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT system_code, name, chamber, parent_committee_system_code, committee_type_code
      FROM committees
      WHERE is_current = true OR is_current IS NULL
      ORDER BY chamber, name
    `);
    
    // Group subcommittees under their parent committees
    const committees = result.rows;
    const parentCommittees = committees.filter(c => !c.parent_committee_system_code);
    const subcommittees = committees.filter(c => c.parent_committee_system_code);

    const committeeTree = parentCommittees.map(parent => ({
        ...parent,
        subcommittees: subcommittees.filter(sub => sub.parent_committee_system_code === parent.system_code)
    }));

    res.json(committeeTree);
  } catch (error) {
    console.error('Error fetching committees:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Committee Detail endpoint - ENHANCED
app.get('/api/committees/:system_code', async (req, res) => {
    const { system_code } = req.params;
    try {
        // Committee details
        const committeeResult = await pool.query('SELECT * FROM committees WHERE system_code = $1', [system_code]);
        if (committeeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Committee not found' });
        }
        
        // Committee history
        const historyResult = await pool.query(`
            SELECT official_name, start_date, end_date, establishing_authority
            FROM committee_history
            WHERE committee_system_code = $1
            ORDER BY start_date DESC
        `, [system_code]);
        
        // Committee reports
        const reportsResult = await pool.query(`
            SELECT cr.id, cr.congress, cr.chamber, cr.type, cr.number, cr.part, 
                   cr.citation, cr.title, cr.issue_date, cr.is_conference_report
            FROM committee_reports cr
            JOIN report_committees rc ON cr.id = rc.report_id
            WHERE rc.committee_system_code = $1
            ORDER BY cr.issue_date DESC
            LIMIT 50
        `, [system_code]);
        
        // Bills referred to committee with unique aliases
        const billsResult = await pool.query(`
            SELECT DISTINCT b.id, b.type, b.number, b.title, b.introduced_date,
                   b.congress, b.policy_area_name,
                   CONCAT(m2.first_name, ' ', m2.last_name) as sponsor_name,
                   b.sponsor_bioguide_id,
                   bc.activity_name, bc.activity_date
            FROM bills b
            JOIN bill_committees bc ON b.id = bc.bill_id
            LEFT JOIN members m2 ON b.sponsor_bioguide_id = m2.bioguide_id
            WHERE bc.committee_system_code = $1
            ORDER BY bc.activity_date DESC
            LIMIT 100
        `, [system_code]);
        
        // Subcommittees
        const subcommitteesResult = await pool.query(`
            SELECT system_code, name, committee_type_code
            FROM committees
            WHERE parent_committee_system_code = $1
            ORDER BY name
        `, [system_code]);
        
        res.json({
            details: committeeResult.rows[0],
            history: historyResult.rows,
            reports: reportsResult.rows,
            bills: billsResult.rows,
            subcommittees: subcommitteesResult.rows
        });
    } catch (error) {
        console.error(`Error fetching committee details for ${system_code}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bills endpoint with comprehensive filtering - MODIFIED
app.get('/api/bills', async (req, res) => {
  try {
    const { title, sponsor, billNumber, party, congress = '119', policyArea, committee } = req.query;

   let baseQuery = `
      SELECT DISTINCT
        b.id,
        b.congress,
        b.type,
        b.number,
        b.title,
        b.introduced_date,
        b.policy_area_name,
        CONCAT(m2.first_name, ' ', m2.last_name) as sponsor_name,
        b.sponsor_bioguide_id,
        sph.party_name as sponsor_party,
        (SELECT COUNT(*) FROM bill_cosponsors WHERE bill_id = b.id) as cosponsor_count,
        (SELECT COUNT(*) FROM bill_actions WHERE bill_id = b.id) as action_count
      FROM bills b
      LEFT JOIN members m2 ON b.sponsor_bioguide_id = m2.bioguide_id
      LEFT JOIN (
        SELECT mph.member_bioguide_id, mph.party_name, mph.party_abbreviation
        FROM member_party_history mph
        INNER JOIN (
            SELECT member_bioguide_id, MAX(start_year) as max_year
            FROM member_party_history
            GROUP BY member_bioguide_id
        ) latest ON mph.member_bioguide_id = latest.member_bioguide_id 
        AND mph.start_year = latest.max_year
      ) sph ON b.sponsor_bioguide_id = sph.member_bioguide_id
      WHERE b.congress = $1
    `;
    
    const whereClauses = [];
    const queryParams = [congress];
    let paramIndex = 2;

    if (title) {
        whereClauses.push(`b.title ILIKE $${paramIndex++}`);
        queryParams.push(`%${title}%`);
    }
    if (sponsor) {
        whereClauses.push(`CONCAT(m2.first_name, ' ', m2.last_name) ILIKE $${paramIndex++}`);
        queryParams.push(`%${sponsor}%`);
    }
    if (billNumber) {
        const billType = (billNumber.match(/[a-zA-Z]+/g) || []).join('');
        const billNum = (billNumber.match(/\d+/g) || []).join('');

        if (billType) {
            whereClauses.push(`b.type ILIKE $${paramIndex++}`);
            queryParams.push(billType);
        }
        if (billNum) {
            whereClauses.push(`b.number = $${paramIndex++}`);
            queryParams.push(parseInt(billNum, 10));
        }
    }
    if (policyArea) {
        whereClauses.push(`b.policy_area_name ILIKE $${paramIndex++}`);
        queryParams.push(`%${policyArea}%`);
    }
    if (committee) {
        baseQuery += ` JOIN bill_committees bc ON b.id = bc.bill_id`;
        whereClauses.push(`bc.committee_system_code = $${paramIndex++}`);
        queryParams.push(committee);
    }
    
    // --- REPLACED BLOCK ---
    // This logic now checks for the party abbreviation OR the full party name, making it much more robust.
        if (party) {
        if (party === 'Republican') {
            whereClauses.push(`(sph.party_abbreviation = 'R' OR sph.party_name ILIKE 'Republican%')`);
        } else if (party === 'Democrat') {
            whereClauses.push(`(sph.party_abbreviation = 'D' OR sph.party_name ILIKE 'Democrat%')`);
        } else if (party === 'Independent') {
            whereClauses.push(`(sph.party_abbreviation = 'I' OR sph.party_name ILIKE 'Independent%')`);
        }
    }
    // --- END REPLACED BLOCK ---

    if (whereClauses.length > 0) {
        baseQuery += ` AND ${whereClauses.join(' AND ')}`;
    }

    baseQuery += ` ORDER BY b.introduced_date DESC LIMIT 200`;

    const result = await pool.query(baseQuery, queryParams);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Bill Detail endpoint - ENHANCED
app.get('/api/bills/:id', async (req, res) => {
    const billId = parseInt(req.params.id, 10);

    if (isNaN(billId)) {
        return res.status(400).json({ error: 'Invalid bill ID provided.' });
    }

    try {
        // Main bill details
        // FIXED: Renamed subquery aliases from 'm' to 'sph' and 'smt' to prevent conflicts.
        const billQuery = `
            SELECT 
                b.*,
                CONCAT(m.first_name, ' ', m.last_name) as sponsor_name,
                sph.party_name as sponsor_party,
                smt.state_code as sponsor_state,
                l.type as law_type,
                l.number as law_number
            FROM bills b
            LEFT JOIN members m ON b.sponsor_bioguide_id = m.bioguide_id
            LEFT JOIN (
                SELECT mph.member_bioguide_id, mph.party_name 
                FROM member_party_history mph
                INNER JOIN (
                    SELECT member_bioguide_id, MAX(start_year) as max_year
                    FROM member_party_history
                    GROUP BY member_bioguide_id
                ) latest ON mph.member_bioguide_id = latest.member_bioguide_id 
                AND mph.start_year = latest.max_year
            ) sph ON b.sponsor_bioguide_id = sph.member_bioguide_id
            LEFT JOIN (
                SELECT mt.member_bioguide_id, mt.state_code
                FROM member_terms mt
                WHERE mt.congress = (SELECT congress FROM bills WHERE id = $1)
                LIMIT 1
            ) smt ON b.sponsor_bioguide_id = smt.member_bioguide_id
            LEFT JOIN laws l ON b.id = l.bill_id
            WHERE b.id = $1`;
        const billResult = await pool.query(billQuery, [billId]);
        
        if (billResult.rows.length === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        // All actions (not just latest)
        const actionsQuery = `
            SELECT 
                ba.id,
                ba.action_date,
                ba.text,
                ba.type,
                ba.action_code,
                ba.source_system_name,
                array_agg(
                    json_build_object(
                        'system_code', c.system_code,
                        'name', c.name
                    )
                ) FILTER (WHERE c.system_code IS NOT NULL) as committees
            FROM bill_actions ba
            LEFT JOIN bill_action_committees bac ON ba.id = bac.action_id
            LEFT JOIN committees c ON bac.committee_system_code = c.system_code
            WHERE ba.bill_id = $1
            GROUP BY ba.id, ba.action_date, ba.text, ba.type, ba.action_code, ba.source_system_name
            ORDER BY ba.action_date DESC`;
        const actionsResult = await pool.query(actionsQuery, [billId]);

        // Cosponsors with party info
        const cosponsorsQuery = `
            SELECT 
                m.bioguide_id, 
                CONCAT(m.first_name, ' ', m.last_name) as name,
                mph.party_name as party,
                mt.state_code as state,
                mt.district,
                bc.sponsorship_date,
                bc.is_original_cosponsor,
                bc.sponsorship_withdrawn_date
            FROM bill_cosponsors bc
            JOIN members m ON bc.member_bioguide_id = m.bioguide_id
            LEFT JOIN LATERAL (
                SELECT party_name 
                FROM member_party_history 
                WHERE member_bioguide_id = m.bioguide_id 
                ORDER BY start_year DESC 
                LIMIT 1
            ) mph ON true
            LEFT JOIN LATERAL (
                SELECT state_code, district 
                FROM member_terms 
                WHERE member_bioguide_id = m.bioguide_id 
                ORDER BY congress DESC 
                LIMIT 1
            ) mt ON true
            WHERE bc.bill_id = $1
            ORDER BY bc.is_original_cosponsor DESC, bc.sponsorship_date`;
        const cosponsorsResult = await pool.query(cosponsorsQuery, [billId]);

        // Committees with activities
        const committeesQuery = `
            SELECT 
                c.system_code,
                c.name,
                c.chamber,
                array_agg(
                    json_build_object(
                        'activity_name', bc.activity_name,
                        'activity_date', bc.activity_date
                    ) ORDER BY bc.activity_date DESC
                ) as activities
            FROM bill_committees bc
            JOIN committees c ON bc.committee_system_code = c.system_code
            WHERE bc.bill_id = $1
            GROUP BY c.system_code, c.name, c.chamber
            ORDER BY c.name`;
        const committeesResult = await pool.query(committeesQuery, [billId]);

        // Committee Reports
        const reportsQuery = `
            SELECT 
                cr.id,
                cr.congress,
                cr.citation,
                cr.title,
                cr.issue_date,
                cr.chamber,
                cr.type,
                cr.number,
                cr.part,
                cr.is_conference_report
            FROM committee_reports cr
            JOIN report_associated_bills rab ON cr.id = rab.report_id
            WHERE rab.bill_id = $1
            ORDER BY cr.issue_date DESC`;
        const reportsResult = await pool.query(reportsQuery, [billId]);

        // CBO Cost Estimates
        const cboQuery = `
            SELECT url, title, description, publication_date
            FROM cbo_cost_estimates
            WHERE bill_id = $1
            ORDER BY publication_date DESC`;
        const cboResult = await pool.query(cboQuery, [billId]);

        // Summaries
        const summariesQuery = `
            SELECT version_code, action_description, action_date, text, updated_at
            FROM bill_summaries
            WHERE bill_id = $1
            ORDER BY action_date DESC`;
        const summariesResult = await pool.query(summariesQuery, [billId]);

        // Text Versions
        const textVersionsQuery = `
            SELECT type, date, url, format
            FROM bill_text_versions
            WHERE bill_id = $1
            ORDER BY date DESC, type`;
        const textVersionsResult = await pool.query(textVersionsQuery, [billId]);

        // Subjects
        const subjectsQuery = `
            SELECT name
            FROM bill_subjects
            WHERE bill_id = $1
            ORDER BY name`;
        const subjectsResult = await pool.query(subjectsQuery, [billId]);

        // Titles
        const titlesQuery = `
            SELECT title_type, title, chamber_code, chamber_name
            FROM bill_titles
            WHERE bill_id = $1
            ORDER BY 
                CASE title_type 
                    WHEN 'Short Title' THEN 1
                    WHEN 'Official Title' THEN 2
                    WHEN 'Display Title' THEN 3
                    ELSE 4
                END`;
        const titlesResult = await pool.query(titlesQuery, [billId]);

        // Related Bills with details - using unique alias
        const relatedBillsQuery = `
            SELECT 
                rb.relationship_type,
                rb.identified_by,
                b2.id as related_bill_id,
                b2.congress,
                b2.type,
                b2.number,
                b2.title,
                CONCAT(m2.first_name, ' ', m2.last_name) as sponsor_name
            FROM related_bills rb
            JOIN bills b2 ON rb.related_bill_id = b2.id
            LEFT JOIN members m2 ON b2.sponsor_bioguide_id = m2.bioguide_id
            WHERE rb.bill_id = $1
            ORDER BY b2.congress DESC, b2.type, b2.number`;
        const relatedBillsResult = await pool.query(relatedBillsQuery, [billId]);
        
        res.json({
            details: billResult.rows[0],
            actions: actionsResult.rows,
            cosponsors: cosponsorsResult.rows,
            committees: committeesResult.rows,
            reports: reportsResult.rows,
            cbo_cost_estimates: cboResult.rows,
            summaries: summariesResult.rows,
            text_versions: textVersionsResult.rows,
            subjects: subjectsResult.rows,
            titles: titlesResult.rows,
            related_bills: relatedBillsResult.rows
        });

    } catch (error) {
        console.error(`Error fetching bill details for ${billId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Members endpoint
app.get('/api/members', async (req, res) => {
  try {
    const congress = req.query.congress || '119';
    const result = await pool.query(`
      SELECT DISTINCT
        m.bioguide_id,
        m.direct_order_name,
        m.inverted_order_name,
        m.first_name,
        m.middle_name,
        m.last_name,
        m.suffix_name,
        m.nickname,
        m.honorific_name,
        m.depiction_image_url,
        m.is_current_member,
        mt.chamber,
        mt.state_code as state,
        mt.district,
        mt.member_type,
        mph.party_name as party,
        mph.party_abbreviation
      FROM members m
      JOIN member_terms mt ON m.bioguide_id = mt.member_bioguide_id
      LEFT JOIN LATERAL (
        SELECT party_name, party_abbreviation
        FROM member_party_history
        WHERE member_bioguide_id = m.bioguide_id
        ORDER BY start_year DESC
        LIMIT 1
      ) mph ON true
      WHERE mt.congress = $1
      ORDER BY m.last_name, m.first_name
    `, [congress]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Member Detail endpoint - ENHANCED
app.get('/api/members/:bioguide_id', async (req, res) => {
    const { bioguide_id } = req.params;
    try {
        // Member details
        const memberQuery = `
            SELECT 
                m.*,
                ma.office_address,
                ma.city,
                ma.district as address_district,
                ma.zip_code,
                ma.phone_number
            FROM members m
            LEFT JOIN member_addresses ma ON m.bioguide_id = ma.member_bioguide_id
            WHERE m.bioguide_id = $1`;
        const memberResult = await pool.query(memberQuery, [bioguide_id]);

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Get current term info
        const currentTermQuery = `
            SELECT chamber, state_code as state, district, member_type
            FROM member_terms 
            WHERE member_bioguide_id = $1 
            ORDER BY congress DESC 
            LIMIT 1`;
        const currentTermResult = await pool.query(currentTermQuery, [bioguide_id]);
        
        // Party history
        const partyHistoryQuery = `
            SELECT party_name, party_abbreviation, start_year
            FROM member_party_history
            WHERE member_bioguide_id = $1
            ORDER BY start_year DESC`;
        const partyHistoryResult = await pool.query(partyHistoryQuery, [bioguide_id]);

        // All terms served
        const termsQuery = `
            SELECT congress, chamber, member_type, state_code, state_name, 
                   district, start_year, end_year
            FROM member_terms
            WHERE member_bioguide_id = $1
            ORDER BY congress DESC`;
        const termsResult = await pool.query(termsQuery, [bioguide_id]);

        // Leadership roles
        const leadershipQuery = `
            SELECT congress, leadership_type, is_current
            FROM member_leadership
            WHERE member_bioguide_id = $1
            ORDER BY congress DESC, is_current DESC`;
        const leadershipResult = await pool.query(leadershipQuery, [bioguide_id]);

        // Sponsored legislation
        const sponsoredBillsQuery = `
            SELECT id, congress, type, number, title, introduced_date, 
                   policy_area_name, constitutional_authority_statement_text,
                   (SELECT COUNT(*) FROM bill_cosponsors WHERE bill_id = bills.id) as cosponsor_count,
                   (SELECT COUNT(*) FROM bill_actions WHERE bill_id = bills.id) as action_count,
                   CASE WHEN EXISTS (SELECT 1 FROM laws WHERE bill_id = bills.id) THEN true ELSE false END as became_law
            FROM bills
            WHERE sponsor_bioguide_id = $1
            ORDER BY introduced_date DESC`;
        const sponsoredBillsResult = await pool.query(sponsoredBillsQuery, [bioguide_id]);

        // Cosponsored legislation with unique aliases
        const cosponsoredBillsQuery = `
            SELECT 
                b.id, b.congress, b.type, b.number, b.title, b.introduced_date,
                bc.sponsorship_date, bc.is_original_cosponsor, bc.sponsorship_withdrawn_date,
                CONCAT(m2.first_name, ' ', m2.last_name) as sponsor_name
            FROM bill_cosponsors bc
            JOIN bills b ON bc.bill_id = b.id
            LEFT JOIN members m2 ON b.sponsor_bioguide_id = m2.bioguide_id
            WHERE bc.member_bioguide_id = $1
            ORDER BY bc.sponsorship_date DESC
            LIMIT 100`;
        const cosponsoredBillsResult = await pool.query(cosponsoredBillsQuery, [bioguide_id]);

        // Committee memberships (inferred from bill committee activities)
        const committeeActivityQuery = `
            SELECT DISTINCT c.system_code, c.name, c.chamber
            FROM bill_committees bc
            JOIN committees c ON bc.committee_system_code = c.system_code
            JOIN bills b ON bc.bill_id = b.id
            WHERE b.sponsor_bioguide_id = $1
            ORDER BY c.chamber, c.name`;
        const committeeActivityResult = await pool.query(committeeActivityQuery, [bioguide_id]);
        
        // Merge current term info with member details
        const memberDetails = {
            ...memberResult.rows[0],
            ...(currentTermResult.rows[0] || {}),
            party: partyHistoryResult.rows[0]?.party_name || null,
            party_abbreviation: partyHistoryResult.rows[0]?.party_abbreviation || null
        };
        
        res.json({
            details: memberDetails,
            party_history: partyHistoryResult.rows,
            terms: termsResult.rows,
            leadership: leadershipResult.rows,
            sponsored_legislation: sponsoredBillsResult.rows,
            cosponsored_legislation: cosponsoredBillsResult.rows,
            committee_activity: committeeActivityResult.rows,
            address: memberResult.rows[0].office_address ? {
                office_address: memberResult.rows[0].office_address,
                city: memberResult.rows[0].city,
                district: memberResult.rows[0].address_district,
                zip_code: memberResult.rows[0].zip_code,
                phone_number: memberResult.rows[0].phone_number
            } : null
        });
    } catch (error) {
        console.error(`Error fetching member details for ${bioguide_id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});