import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import { ChevronLeft, Loader, ExternalLink, Globe, Phone, MapPin, Newspaper, Scroll, Youtube, Key } from 'lucide-react';

// --- API Service ---
const API_BASE_URL = 'http://localhost:3001/api';

const api = {
  fetchCommittees: async () => {
    const response = await fetch(`${API_BASE_URL}/committees`);
    if (!response.ok) throw new Error('Failed to fetch committees');
    return await response.json();
  },
  fetchCommitteeDetails: async (systemCode) => {
    const response = await fetch(`${API_BASE_URL}/committees/${systemCode}`);
    if (!response.ok) throw new Error('Failed to fetch committee details');
    return await response.json();
  },
  fetchBills: async (filters = {}) => {
    const activeFilters = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v));
    const query = new URLSearchParams(activeFilters).toString();
    const response = await fetch(`${API_BASE_URL}/bills?${query}`);
    if (!response.ok) throw new Error('Failed to fetch bills');
    return await response.json();
  },
  fetchBillDetails: async (id) => {
    const response = await fetch(`${API_BASE_URL}/bills/${id}`);
    if (!response.ok) throw new Error('Failed to fetch bill details');
    return await response.json();
  },
  fetchMembers: async (congress = '119') => {
    const response = await fetch(`${API_BASE_URL}/members?congress=${congress}`);
    if (!response.ok) throw new Error('Failed to fetch members');
    return await response.json();
  },
  fetchMemberDetails: async (bioguideId) => {
    const response = await fetch(`${API_BASE_URL}/members/${bioguideId}`);
    if (!response.ok) throw new Error('Failed to fetch member details');
    return await response.json();
  }
};

// --- State Name Mapping ---
const stateNames = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "AS": "American Samoa", "DC": "District of Columbia", "FM": "Federated States of Micronesia",
    "GU": "Guam", "MH": "Marshall Islands", "MP": "Northern Mariana Islands", "PW": "Palau",
    "PR": "Puerto Rico", "VI": "U.S. Virgin Islands"
};

// --- Helper Functions & Shared Components ---

const getPartyClass = (party) => {
    if (!party) return 'other';
    const partyLower = party.toLowerCase();
    if (partyLower.includes('democrat')) return 'democrat';
    if (partyLower.includes('republican')) return 'republican';
    return 'other';
};

// Helper to format bill type for Congress.gov URL
const billUrlTypeMap = {
    s: 'senate-bill',
    hr: 'house-bill',
    sres: 'senate-resolution',
    hres: 'house-resolution',
    sjres: 'senate-joint-resolution',
    hjres: 'house-joint-resolution',
    sconres: 'senate-concurrent-resolution',
    hconres: 'house-concurrent-resolution',
};
const getBillUrlType = (type) => billUrlTypeMap[type.toLowerCase()] || `${type.toLowerCase()}-bill`;

const FilterInput = ({ name, value, onChange, placeholder }) => (
    <input type="text" name={name} value={value} onChange={onChange} placeholder={placeholder} className="filter-control" />
);

const FilterSelect = ({ name, value, onChange, children }) => (
    <select name={name} value={value} onChange={onChange} className="filter-control">{children}</select>
);

const BackButton = ({ onClick }) => (
  <button onClick={onClick} className="back-button"><ChevronLeft size={16} /> Back</button>
);

const PageContainer = ({ children }) => <div className="page-container">{children}</div>;
const PageHeader = ({ title, subtitle }) => (
    <div className="page-header">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
);
const LoadingSpinner = () => <div className="loading-overlay"><Loader className="loading-icon" size={48} /></div>;

const MemberPortrait = ({ member, size = '120px' }) => {
  const [imgStatus, setImgStatus] = useState('loading');
  const initials = `${member.first_name?.[0] || ''}${member.last_name?.[0] || ''}`.toUpperCase();
  const imageUrl = member.depiction_image_url;

  useEffect(() => {
    if (!imageUrl) {
        setImgStatus('error');
        return;
    }
    setImgStatus('loading');
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => setImgStatus('loaded');
    img.onerror = () => setImgStatus('error');
  }, [imageUrl]);
  
  return (
    <div className="member-portrait" style={{ width: size, height: size }}>
      {imgStatus === 'loading' && <div className="portrait-loader animate-pulse"></div>}
      {imgStatus === 'error' && <div className={`member-initials`}><span>{initials}</span></div>}
      {imgStatus === 'loaded' && <img src={imageUrl} alt={`Portrait of ${member.direct_order_name || `${member.first_name} ${member.last_name}`}`} />}
    </div>
  );
};

const PartyButton = ({ name, party, bioguideId, onNavigate, details }) => {
    const partyClass = getPartyClass(party);
    return (
        <button
            className={`party-button ${partyClass}`}
            onClick={(e) => {
                e.stopPropagation();
                onNavigate({ page: 'memberDetail', id: bioguideId });
            }}
        >
            {name} {details && <span style={{fontWeight: 400, opacity: 0.8}}>({details})</span>}
        </button>
    );
};

const DetailSectionCard = ({title, children}) => (
    <div className="card detail-section">
        <h2 className="detail-section-title">{title}</h2>
        {children}
    </div>
)

// --- Page Components ---

const HomePage = ({ onNavigate }) => (
    <PageContainer>
        <div className="home-hero">
            <h1 className="home-title">The Public View</h1>
            <p className="home-subtitle">Explore committees, legislation, and members of Congress.</p>
            <div className="home-buttons">
                <button onClick={() => onNavigate({ page: 'members' })} className="btn btn-primary">Browse Members</button>
                <button onClick={() => onNavigate({ page: 'legislation' })} className="btn btn-primary">Search Legislation</button>
                <button onClick={() => onNavigate({ page: 'committees' })} className="btn btn-primary">View Committees</button>
            </div>
        </div>
    </PageContainer>
);

const MembersPage = ({ onBack, onNavigate, members, loading }) => {
  const [filters, setFilters] = useState({ name: '', party: '', state: '', chamber: '' });

  const handleFilterChange = (e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const filteredMembers = useMemo(() => members.filter(m => 
    (m.direct_order_name?.toLowerCase() || `${m.first_name} ${m.last_name}`.toLowerCase()).includes(filters.name.toLowerCase()) &&
    (!filters.party || m.party === filters.party) &&
    (!filters.state || m.state.toLowerCase().startsWith(filters.state.toLowerCase())) &&
    (!filters.chamber || m.chamber === filters.chamber)
  ), [members, filters]);

  const parties = useMemo(() => [...new Set(members.map(m => m.party).filter(Boolean))].sort(), [members]);
  const chambers = useMemo(() => [...new Set(members.map(m => m.chamber).filter(Boolean))].sort(), [members]);

  return (
    <PageContainer>
      <BackButton onClick={onBack} />
      <PageHeader title="Browse Members" subtitle={`Search the 119th Congress`} />
      {loading ? <LoadingSpinner /> : <>
        <div className="filter-bar">
            <FilterInput name="name" value={filters.name} onChange={handleFilterChange} placeholder="Search by Name..." />
            <FilterInput name="state" value={filters.state} onChange={handleFilterChange} placeholder="State (e.g. CA)" />
            <FilterSelect name="party" value={filters.party} onChange={handleFilterChange}>
                <option value="">All Parties</option>
                {parties.map(p => <option key={p} value={p}>{p}</option>)}
            </FilterSelect>
            <FilterSelect name="chamber" value={filters.chamber} onChange={handleFilterChange}>
                <option value="">All Chambers</option>
                {chambers.map(c => <option key={c} value={c}>{c}</option>)}
            </FilterSelect>
        </div>
        <div className="data-grid">
            {filteredMembers.map(member => (
                <div key={member.bioguide_id} className="card clickable member-card" onClick={() => onNavigate({ page: 'memberDetail', id: member.bioguide_id })}>
                    <MemberPortrait member={member} />
                    <h3 className="member-name">{member.first_name} {member.last_name}</h3>
                    <p className="member-details">{member.chamber}, {stateNames[member.state] || member.state}{member.district && `-${member.district}`}</p>
                    <span className={`party-tag ${getPartyClass(member.party)}`}>{member.party || 'N/A'}</span>
                </div>
            ))}
        </div>
      </>}
    </PageContainer>
  );
};

const LegislationPage = ({ onBack, onNavigate }) => {
    const [bills, setBills] = useState([]);
    const [filters, setFilters] = useState({ title: '', sponsor: '', billNumber: '', party: '' });
    const [loading, setLoading] = useState(false);
    
    const useDebounce = (value, delay) => {
        const [debouncedValue, setDebouncedValue] = useState(value);
        useEffect(() => {
            const handler = setTimeout(() => { setDebouncedValue(value); }, delay);
            return () => { clearTimeout(handler); };
        }, [value, delay]);
        return debouncedValue;
    };

    const debouncedFilters = useDebounce(filters, 500);

const loadBills = useCallback(async (currentFilters) => {
    setLoading(true);
    try {
        const data = await api.fetchBills(currentFilters);
        setBills(data);
    } catch (error) {
        console.error("Failed to fetch bills:", error);
    } finally {
        setLoading(false);
    }
}, []);

    useEffect(() => { loadBills(debouncedFilters); }, [debouncedFilters, loadBills]);

    const handleFilterChange = e => setFilters(prev => ({...prev, [e.target.name]: e.target.value}));

    return (
        <PageContainer>
            <BackButton onClick={onBack} />
            <PageHeader title="Search All Legislation" />
            <div className="filter-bar">
                <FilterInput name="title" value={filters.title} onChange={handleFilterChange} placeholder="Search by Title..."/>
                <FilterInput name="sponsor" value={filters.sponsor} onChange={handleFilterChange} placeholder="Search by Sponsor Name..."/>
                <FilterInput name="billNumber" value={filters.billNumber} onChange={handleFilterChange} placeholder="Search by Bill Number..."/>
                <FilterSelect name="party" value={filters.party} onChange={handleFilterChange}>
                    <option value="">All Parties</option>
                    <option value="Republican">Republican</option>
                    <option value="Democrat">Democrat</option>
                    <option value="Independent">Independent</option>
                </FilterSelect>
            </div>
            {loading ? <LoadingSpinner /> : (
                <div className="info-grid">
                    {bills.map(bill => (
                        <div key={bill.id} className="card clickable bill-card" onClick={() => onNavigate({ page: 'legislationDetail', id: bill.id })}>
                            <div className="bill-card-header">
                                <h2 className="bill-identifier">{bill.type.toUpperCase()}.{bill.number}</h2>
                            </div>
                            <p className="bill-title">{bill.title}</p>
                            <p className="bill-detail"><strong>Introduced:</strong> {new Date(bill.introduced_date).toLocaleDateString()}</p>
                            <p className="bill-detail"><strong>Sponsor:</strong> <span className={`link-like party-button ${getPartyClass(bill.sponsor_party)}`} onClick={(e) => { e.stopPropagation(); onNavigate({ page: 'memberDetail', id: bill.sponsor_bioguide_id })}}>{bill.sponsor_name}</span></p>
                            {bill.policy_area_name && <p className="bill-detail"><strong>Policy Area:</strong> {bill.policy_area_name}</p>}
                            <p className="bill-detail"><strong>Cosponsors:</strong> {bill.cosponsor_count} | <strong>Actions:</strong> {bill.action_count}</p>
                        </div>
                    ))}
                </div>
            )}
        </PageContainer>
    );
};

const MemberDetailPage = ({ bioguideId, onBack, onNavigate }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        api.fetchMemberDetails(bioguideId).then(setData).catch(console.error).finally(() => setLoading(false));
    }, [bioguideId]);

    if (loading) return <LoadingSpinner />;
    if (!data) return <PageContainer><BackButton onClick={onBack} /><PageHeader title="Member Not Found" /></PageContainer>;

    const { details, sponsored_legislation, cosponsored_legislation, terms, leadership, party_history, address } = data;

    return (
        <PageContainer>
            <BackButton onClick={onBack} />
            <div className="detail-page-grid member-detail-page">
                <aside className="member-detail-sidebar">
                    <div className="card member-profile-card">
                         <MemberPortrait member={details} size="150px"/>
                         <h1 className="member-name">{details.direct_order_name}</h1>
                         <p className="member-details">{details.chamber} for {stateNames[details.state] || details.state}{details.district ? `-${details.district}` : ''}</p>
                         <span className={`party-tag ${getPartyClass(details.party)}`}>{details.party}</span>
                            <div className="member-social-links">
                                {details.official_url && <a href={details.official_url} target="_blank" rel="noopener noreferrer" title="Official Website"><Globe size={18} /></a>}
                                <a href={`https://www.congress.gov/member/${encodeURIComponent(details.first_name + '-' + details.last_name) + '/'+  encodeURIComponent(details.bioguide_id)}`} target="_blank" rel="noopener noreferrer" title="Congress.gov Profile"><ExternalLink size={18} /></a>
                                <a href={`https://www.opensecrets.org/members-of-congress/search?q=${encodeURIComponent(details.direct_order_name)}`} target="_blank" rel="noopener noreferrer" title="OpenSecrets Profile"><Key size={18} /></a>
                                <a href={`https://ballotpedia.org/${encodeURIComponent(details.first_name + '_' + details.last_name)}`} target="_blank" rel="noopener noreferrer" title="Ballotpedia Profile"><Scroll size={18} /></a>
                                <a href={`https://www.google.com/search?tbm=nws&q=${encodeURIComponent(details.direct_order_name)}`} target="_blank" rel="noopener noreferrer" title={`News about ${details.direct_order_name}`}><Newspaper size={18} /></a>
                                <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(details.chamber + ' ' + details.direct_order_name)}`} target="_blank" rel="noopener noreferrer" title="YouTube Videos"><Youtube size={18} /></a>
                            </div>
                    </div>
                    
                    <DetailSectionCard title="About">
                         <ul className="detail-list">
                            <li><strong>Born:</strong> <span>{details.birth_year}</span></li>
                             {details.death_year && <li><strong>Died:</strong> <span>{details.death_year}</span></li>}
                            <li><strong>Party:</strong> <span>{details.party}</span></li>
                             <li><strong>State:</strong> <span>{stateNames[details.state]}</span></li>
                             {details.district && <li><strong>District:</strong> <span>{details.district}</span></li>}
                             {details.member_type && <li><strong>Type:</strong> <span>{details.member_type}</span></li>}
                         </ul>
                    </DetailSectionCard>
                    
                    {address && (
                        <DetailSectionCard title="Contact">
                            <ul className="detail-list">
                                {address.office_address && <li><MapPin size={16} style={{marginRight: '8px'}} /> {address.office_address}, {address.city}, {address.district} {address.zip_code}</li>}
                                {address.phone_number && <li><Phone size={16} style={{marginRight: '8px'}} /> {address.phone_number}</li>}
                            </ul>
                        </DetailSectionCard>
                    )}
                    
                    {party_history && party_history.length > 1 && (
                        <DetailSectionCard title="Party History">
                            <ul className="detail-list">
                                {party_history.map((p, idx) => (
                                    <li key={idx}>
                                        <strong>{p.party_name}</strong>
                                        <span>{p.start_year}-{idx === 0 ? 'Present' : party_history[idx-1].start_year-1}</span>
                                    </li>
                                ))}
                            </ul>
                        </DetailSectionCard>
                    )}
                     
                    {leadership && leadership.length > 0 && (
                        <DetailSectionCard title="Leadership Roles">
                             <ul className="detail-list">
                                 {leadership.map((l, idx) => (
                                     <li key={idx}>
                                         <span>{l.leadership_type}</span>
                                         <span>{l.congress}th{l.is_current && ' (Current)'}</span>
                                     </li>
                                 ))}
                             </ul>
                        </DetailSectionCard>
                    )}
                    
                    {terms && terms.length > 0 && (
                        <DetailSectionCard title="Terms Served">
                            <ul className="detail-list">
                                {terms.map((t, idx) => (
                                    <li key={idx}>
                                        <strong>{t.congress}th Congress</strong>
                                        <span>{t.chamber} ({t.start_year}-{t.end_year || 'Present'})</span>
                                    </li>
                                ))}
                            </ul>
                        </DetailSectionCard>
                    )}
                </aside>
                <main className="detail-main-content">
                     <DetailSectionCard title={`Sponsored Legislation (${sponsored_legislation.length})`}>
                        <div className="info-grid" >
                            {sponsored_legislation.map(bill => (
                                <div key={bill.id} className="card clickable bill-card" onClick={() => onNavigate({ page: 'legislationDetail', id: bill.id })}>
                                     <div className="bill-card-header">
                                        <h3 className="bill-identifier">{bill.type.toUpperCase()}.{bill.number}</h3>
                                    </div>
                                    <p className="bill-title">{bill.title}</p>
                                    <p className="bill-detail"><strong>Introduced:</strong> {new Date(bill.introduced_date).toLocaleDateString()}</p>
                                    {bill.policy_area_name && <p className="bill-detail"><strong>Policy Area:</strong> {bill.policy_area_name}</p>}
                                    <p className="bill-detail">
                                        <strong>Cosponsors:</strong> {bill.cosponsor_count} | 
                                        <strong> Actions:</strong> {bill.action_count}
                                        {bill.became_law && <span className="law-indicator"> | Became Law</span>}
                                    </p>
                                </div>
                            ))}
                        </div>
                     </DetailSectionCard>
                     
                     {cosponsored_legislation && cosponsored_legislation.length > 0 && (
                         <DetailSectionCard title={`Cosponsored Legislation (${cosponsored_legislation.length})`}>
                            <div className="info-grid">
                                {cosponsored_legislation.slice(0, 20).map(bill => (
                                    <div key={bill.id} className="card clickable bill-card" onClick={() => onNavigate({ page: 'legislationDetail', id: bill.id })}>
                                         <div className="bill-card-header">
                                            <h3 className="bill-identifier">{bill.type.toUpperCase()}.{bill.number}</h3>
                                        </div>
                                        <p className="bill-title">{bill.title}</p>
                                        <p className="bill-detail"><strong>Sponsor:</strong> {bill.sponsor_name}</p>
                                        <p className="bill-detail">
                                            <strong>Cosponsored:</strong> {new Date(bill.sponsorship_date).toLocaleDateString()}
                                            {bill.is_original_cosponsor && <span style={{color: 'blue'}}> (Original)</span>}
                                            {bill.sponsorship_withdrawn_date && <span style={{color: 'red'}}> (Withdrawn)</span>}
                                        </p>
                                    </div>
                                ))}
                            </div>
                         </DetailSectionCard>
                     )}
                </main>
            </div>
        </PageContainer>
    );
};

const LegislationDetailPage = ({ billId, onBack, onNavigate, members }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const memberMap = useMemo(() => new Map(members.map(m => [m.bioguide_id, m])), [members]);

    useEffect(() => {
        api.fetchBillDetails(billId).then(setData).catch(console.error).finally(() => setLoading(false));
    }, [billId]);

    const groupedTextVersions = useMemo(() => {
        if (!data?.text_versions) return [];
        const groups = data.text_versions.reduce((acc, version) => {
            const key = `${version.type}-${version.date}`;
            if (!acc[key]) {
                acc[key] = {
                    type: version.type,
                    date: version.date,
                    formats: [],
                };
            }
            acc[key].formats.push({ url: version.url, format: version.format });
            return acc;
        }, {});
        return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [data?.text_versions]);

    if (loading || members.length === 0) return <LoadingSpinner />;
    if (!data) return <PageContainer><BackButton onClick={onBack} /><PageHeader title="Legislation Not Found" /></PageContainer>;

    const { details, cosponsors, committees, reports, summaries, actions, titles, cbo_cost_estimates, related_bills } = data;
    const sponsor = memberMap.get(details.sponsor_bioguide_id);
    const latestSummary = summaries?.[0] || null;
    const latestAction = actions?.[0] || null;

    return (
        <PageContainer>
            <BackButton onClick={onBack} />
            <PageHeader
                title={`${details.type.toUpperCase()}. ${details.number}: ${details.title}`}
                subtitle={details.law_number ? `Became ${details.law_type} ${details.law_number}` : (titles.find(t => t.title_type === 'Short Title')?.title || null)}
            />

            <div className="detail-page-grid legislation-detail-page" style={{marginTop: '1.5rem'}}>
                <main className="detail-main-content">
                    {latestSummary && (
                        <DetailSectionCard title={`Summary (${latestSummary.action_description})`}>
                            <div className="summary-text-container" dangerouslySetInnerHTML={{ __html: latestSummary.text }} />
                        </DetailSectionCard>
                    )}
                    
                    <DetailSectionCard title={`Legislative Actions (${actions.length})`}>
                        <ul className="actions-grid">
                            {actions.map(action => (
                                <li key={action.id} className="action-item">
                                    <div className="action-header">
                                        <strong>{new Date(action.action_date).toLocaleDateString()}</strong>
                                        {action.type && <span className="party-tag other">{action.type}</span>}
                                    </div>
                                    <p className="action-text">{action.text}</p>
                                    {action.committees?.length > 0 && (
                                        <div className="action-committees">
                                            Committees: {action.committees.map(c => c.name).join(', ')}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </DetailSectionCard>
                    
                    <DetailSectionCard title={`Cosponsors (${cosponsors.length})`}>
                         <div className="cosponsors-grid">
                             {cosponsors.map(c => {
                                 const cosponsorMember = memberMap.get(c.bioguide_id);
                                 return <PartyButton 
                                     key={c.bioguide_id} 
                                     name={`${c.name}, ${stateNames[c.state] || ''}`}
                                     party={c.party || cosponsorMember?.party} 
                                     bioguideId={c.bioguide_id} 
                                     onNavigate={onNavigate}
                                 />;
                             })}
                         </div>
                    </DetailSectionCard>
                    
                     {related_bills?.length > 0 && (
                         <DetailSectionCard title="Related Legislation">
                            <div className="related-bills-grid">
                                 {related_bills.map((rb, idx) => (
                                     <div key={idx} className="related-bill-item clickable" onClick={() => onNavigate({ page: 'legislationDetail', id: rb.related_bill_id })}>
                                         <strong>{rb.type.toUpperCase()}.{rb.number}</strong>
                                         <span className="relationship-type">{rb.relationship_type}</span>
                                     </div>
                                 ))}
                            </div>
                         </DetailSectionCard>
                     )}
                </main>
                
                <aside className="member-detail-sidebar">
                    <DetailSectionCard title="Sponsor">
                         {sponsor && <PartyButton 
                             name={details.sponsor_name} 
                             party={details.sponsor_party || sponsor.party} 
                             bioguideId={details.sponsor_bioguide_id} 
                             onNavigate={onNavigate} 
                             details={`${stateNames[details.sponsor_state || sponsor.state] || sponsor.state}${sponsor.district ? `-${sponsor.district}` : ''}`} 
                         />}
                         {details.is_by_request && <p style={{marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)'}}>Introduced by request</p>}
                    </DetailSectionCard>

                    <DetailSectionCard title="Bill Information">
                         <ul className="detail-list">
                             <li><strong>Congress:</strong> <span>{details.congress}th</span></li>
                             <li><strong>Introduced:</strong> <span>{new Date(details.introduced_date).toLocaleDateString()}</span></li>
                             {details.policy_area_name && <li><strong>Policy Area:</strong> <span>{details.policy_area_name}</span></li>}
                             {details.origin_chamber && <li><strong>Origin Chamber:</strong> <span>{details.origin_chamber}</span></li>}
                             {latestAction && (
                                <li className="latest-action-item">
                                    <strong>Latest Action:</strong>
                                    <span title={latestAction.text}>
                                        ({new Date(latestAction.action_date).toLocaleDateString()}) {latestAction.text}
                                    </span>
                                </li>
                            )}
                         </ul>
                    </DetailSectionCard>
                    
                    <DetailSectionCard title="Committee Referrals">
                         {committees.length > 0 ? (
                             <ul className="detail-list">
                                 {committees.map(c => (
                                    <li key={c.system_code}>
                                        <span className="link-like" onClick={() => onNavigate({ page: 'committeeDetail', id: c.system_code })}>{c.name}</span>
                                        <ul style={{fontSize: '0.875rem', marginTop: '0.25rem', paddingLeft: '1rem'}}>
                                            {c.activities.map((activity, idx) => (
                                                <li key={idx} style={{color: 'var(--text-muted)'}}>{activity.activity_name} ({new Date(activity.activity_date).toLocaleDateString()})</li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                             </ul>
                         ) : <p>No committee referrals.</p>}
                     </DetailSectionCard>

                    {groupedTextVersions.length > 0 && (
                        <DetailSectionCard title="Text Versions">
                            {groupedTextVersions.map(group => (
                                <div key={group.type + group.date} className="text-version-group">
                                    <p className="version-info">{group.type} <span>({new Date(group.date).toLocaleDateString()})</span></p>
                                    <div className="format-buttons">
                                        {group.formats.map(v => (
                                            <a key={v.url} className="btn-format" href={v.url} target="_blank" rel="noopener noreferrer">
                                                {v.format} <ExternalLink size={12}/>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </DetailSectionCard>
                    )}

                     {reports?.length > 0 && (
                         <DetailSectionCard title="Committee Reports">
                             <ul className="detail-list">
                                 {reports.map(r => {
                                    const reportUrl = `https://www.congress.gov/congressional-report/${r.congress}th-congress/${r.chamber.toLowerCase()}-report/${r.number}`;
                                    return (
                                        <li key={r.citation}>
                                            <a className="link-like" href={reportUrl} target="_blank" rel="noopener noreferrer">{r.citation} <ExternalLink size={14} /></a>
                                            <p style={{fontSize: '0.875rem', marginTop: '0.25rem'}}>{r.title}</p>
                                        </li>
                                    );
                                 })}
                             </ul>
                         </DetailSectionCard>
                     )}

                     {cbo_cost_estimates?.length > 0 && (
                         <DetailSectionCard title="CBO Cost Estimates">
                             <ul className="detail-list">
                                 {cbo_cost_estimates.map((cbo, idx) => (
                                     <li key={idx}>
                                         <a className="link-like" href={cbo.url} target="_blank" rel="noopener noreferrer">{cbo.title || 'Cost Estimate'} <ExternalLink size={14} /></a>
                                         <span style={{fontSize: '0.875rem', color: 'var(--text-muted)', display: 'block'}}>{new Date(cbo.publication_date).toLocaleDateString()}</span>
                                     </li>
                                 ))}
                             </ul>
                         </DetailSectionCard>
                     )}
                     
                     <DetailSectionCard title="Outgoing Links">
                        <ul className="detail-list">
                            <li><a className="link-like" href={`https://www.congress.gov/bill/${details.congress}th-congress/${getBillUrlType(details.type)}/${details.number}`} target="_blank" rel="noopener noreferrer">View on Congress.gov <ExternalLink size={14}/></a></li>
                            <li><a className="link-like" href={`https://www.google.com/search?q=${details.type.toUpperCase()}+${details.number}+${details.congress}th+congress`} target="_blank" rel="noopener noreferrer">Search on Google <ExternalLink size={14}/></a></li>
                        </ul>
                     </DetailSectionCard>
                </aside>
            </div>
        </PageContainer>
    );
};

const CommitteesPage = ({ onBack, onNavigate }) => {
    const [committeeTree, setCommitteeTree] = useState([]);
    const [filters, setFilters] = useState({ name: '', chamber: '' });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.fetchCommittees().then(data => {
            setCommitteeTree(data);
            setLoading(false);
        }).catch(console.error);
    }, []);

    const handleFilterChange = e => setFilters(prev => ({...prev, [e.target.name]: e.target.value }));

    const filteredTree = useMemo(() => committeeTree.filter(c => 
        (!filters.chamber || c.chamber === filters.chamber) &&
        (!filters.name || c.name.toLowerCase().includes(filters.name.toLowerCase()) || c.subcommittees.some(s => s.name.toLowerCase().includes(filters.name.toLowerCase())))
    ), [committeeTree, filters]);

    const chambers = useMemo(() => [...new Set(committeeTree.map(c => c.chamber).filter(Boolean))].sort(), [committeeTree]);

    return (
        <PageContainer>
            <BackButton onClick={onBack} />
            <PageHeader title="Congressional Committees" />
            {loading ? <LoadingSpinner /> : <>
                <div className="filter-bar">
                    <FilterInput name="name" value={filters.name} onChange={handleFilterChange} placeholder="Search by Committee Name..."/>
                    <FilterSelect name="chamber" value={filters.chamber} onChange={handleFilterChange}>
                        <option value="">All Chambers</option>
                        {chambers.map(c => <option key={c} value={c}>{c}</option>)}
                    </FilterSelect>
                </div>
                <div className="info-grid committee-grid">
                    {filteredTree.map(parent => (
                        <div key={parent.system_code} className="card clickable committee-card" style={{padding: '1.5rem'}} onClick={() => onNavigate({ page: 'committeeDetail', id: parent.system_code })}>
                            <h2>{parent.name}</h2>
                            <p>{parent.chamber} {parent.committee_type_code && `- ${parent.committee_type_code}`}</p>
                            {parent.subcommittees?.length > 0 && (
                                <div className="subcommittee-section">
                                    <h3 className="subcommittee-heading">Subcommittees ({parent.subcommittees.length})</h3>
                                    <ul className="subcommittee-list">
                                        {parent.subcommittees.map(sub => <li key={sub.system_code} onClick={(e) => { e.stopPropagation(); onNavigate({ page: 'committeeDetail', id: sub.system_code})}}>{sub.name}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </>}
        </PageContainer>
    );
};


const CommitteeDetailPage = ({ systemCode, onBack, onNavigate }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.fetchCommitteeDetails(systemCode).then(setData).catch(console.error).finally(() => setLoading(false));
    }, [systemCode]);

    if (loading) return <LoadingSpinner />;
    if (!data) return <PageContainer><BackButton onClick={onBack} /><PageHeader title="Committee Not Found" /></PageContainer>;
    
    const { details, bills, history, reports, subcommittees } = data;

    return (
        <PageContainer>
            <BackButton onClick={onBack} />
            <PageHeader title={details.name} subtitle={`${details.chamber} ${details.committee_type_code ? `- ${details.committee_type_code}` : ''}`} />

            <div className="detail-page-grid">
                <aside className="member-detail-sidebar">
                    {history && history.length > 0 && (
                        <DetailSectionCard title="Committee History">
                            <ul className="detail-list">
                                {history.map((h, idx) => (
                                    <li key={idx}>
                                        <strong>{h.official_name}</strong>
                                        <span>{new Date(h.start_date).getFullYear()}{h.end_date ? `-${new Date(h.end_date).getFullYear()}` : '-Present'}</span>
                                    </li>
                                ))}
                            </ul>
                        </DetailSectionCard>
                    )}
                    
                    {subcommittees && subcommittees.length > 0 && (
                        <DetailSectionCard title="Subcommittees">
                            <ul className="detail-list">
                                {subcommittees.map(sub => (
                                    <li key={sub.system_code} className="link-like" onClick={() => onNavigate({ page: 'committeeDetail', id: sub.system_code })}>
                                        {sub.name}
                                    </li>
                                ))}
                            </ul>
                        </DetailSectionCard>
                    )}
                </aside>

                <main className="detail-main-content">
                    {reports && reports.length > 0 && (
                        <DetailSectionCard title={`Committee Reports (${reports.length})`}>
                            <ul className="detail-list">
                                {reports.slice(0, 10).map(report => {
                                    const reportUrl = `https://www.congress.gov/congressional-report/${report.congress}th-congress/${report.chamber.toLowerCase()}-report/${report.number}`;
                                    return (
                                        <li key={report.id}>
                                            <a className="link-like" href={reportUrl} target="_blank" rel="noopener noreferrer">
                                                {report.citation} <ExternalLink size={14} />
                                            </a>
                                            {report.title && <p style={{fontSize: '0.875rem', marginTop: '0.25rem'}}>{report.title}</p>}
                                            <span style={{fontSize: '0.875rem', color: 'var(--text-muted)'}}>{new Date(report.issue_date).toLocaleDateString()}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </DetailSectionCard>
                    )}

                    <DetailSectionCard title={`Related Legislation (${bills.length})`}>
                        <div className="info-grid">
                            {bills.map(bill => (
                                <div key={bill.id} className="card clickable bill-card" onClick={() => onNavigate({ page: 'legislationDetail', id: bill.id })}>
                                     <div className="bill-card-header">
                                        <h2 className="bill-identifier">{bill.type.toUpperCase()}.{bill.number}</h2>
                                    </div>
                                    <p className="bill-title">{bill.title}</p>
                                    <p className="bill-detail"><strong>Introduced:</strong> {new Date(bill.introduced_date).toLocaleDateString()}</p>
                                    {bill.sponsor_name && <p className="bill-detail"><strong>Sponsor:</strong> {bill.sponsor_name}</p>}
                                    {bill.activity_name && <p className="bill-detail"><strong>Activity:</strong> {bill.activity_name} ({new Date(bill.activity_date).toLocaleDateString()})</p>}
                                </div>
                            ))}
                        </div>
                    </DetailSectionCard>
                </main>
            </div>
        </PageContainer>
    );
};


// --- Main App Component ---
const App = () => {
  const [route, setRoute] = useState({ page: 'home' });
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    api.fetchMembers().then(data => {
      setMembers(data);
    }).catch(error => {
        console.error("Failed to fetch members", error);
    }).finally(() => {
      setLoadingMembers(false);
    });
  }, []);

  const handleNavigate = (newRoute) => setRoute(newRoute);
  
  const handleBack = () => {
    if (route.page.endsWith('Detail')) {
      const listPageKey = route.page.replace('Detail', '').toLowerCase() + 's';
      const validPages = ['members', 'committees', 'legislations'];
      if (validPages.includes(listPageKey)) {
        setRoute({ page: listPageKey.replace('legislations', 'legislation') });
        return;
      }
    }
    setRoute({ page: 'home' });
  };
  
  const renderPage = () => {
    switch (route.page) {
      case 'committees': return <CommitteesPage onBack={handleBack} onNavigate={handleNavigate} />;
      case 'committeeDetail': return <CommitteeDetailPage systemCode={route.id} onBack={handleBack} onNavigate={handleNavigate} />;
      case 'legislation': return <LegislationPage onBack={handleBack} onNavigate={handleNavigate} />;
      case 'legislationDetail': return <LegislationDetailPage billId={route.id} onBack={handleBack} onNavigate={handleNavigate} members={members} />;
      case 'members': return <MembersPage onBack={handleBack} onNavigate={handleNavigate} members={members} loading={loadingMembers} />;
      case 'memberDetail': return <MemberDetailPage bioguideId={route.id} onBack={handleBack} onNavigate={handleNavigate} />;
      default: return <HomePage onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <nav className="app-nav">
          <button onClick={() => handleNavigate({ page: 'home' })} className="nav-brand nav-link">The Public View</button>
          <button onClick={() => handleNavigate({ page: 'committees'})} className="nav-link">Committees</button>
          <button onClick={() => handleNavigate({ page: 'legislation'})} className="nav-link">Legislation</button>
          <button onClick={() => handleNavigate({ page: 'members'})} className="nav-link">Members</button>
        </nav>
      </header>
      <main>
        {renderPage()}
      </main>
    </div>
  );
};

export default App;