// services/test-server.js
// A simple server to test if everything is working

import express from 'express';
import cors from 'cors';

const app = express();

// Enable CORS for everything
app.use(cors());

// Simple test endpoint
app.get('/api/test', (req, res) => {
  console.log('Test endpoint hit!');
  res.json({ message: 'Server is working!', timestamp: new Date() });
});

// Mock data endpoints
app.get('/api/committees', (req, res) => {
  console.log('Committees endpoint hit!');
  res.json([
    {
      system_code: 'HSAG',
      name: 'Committee on Agriculture',
      chamber: 'House',
      parent_committee_system_code: null
    },
    {
      system_code: 'HSAG00',
      name: 'Conservation and Forestry',
      chamber: 'House',
      parent_committee_system_code: 'HSAG'
    }
  ]);
});

app.get('/api/members', (req, res) => {
  console.log('Members endpoint hit!');
  res.json([
    {
      bioguide_id: 'A000001',
      first_name: 'John',
      last_name: 'Adams',
      chamber: 'House',
      state: 'MA',
      district: 1,
      party: 'Democratic'
    }
  ]);
});

app.get('/api/bills', (req, res) => {
  console.log('Bills endpoint hit!');
  res.json([
    {
      id: 1,
      type: 'H.R.',
      number: 1234,
      title: 'Test Bill for Testing',
      introduced_date: '2024-01-01',
      sponsor_name: 'John Adams',
      committees: ['Agriculture']
    }
  ]);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log('Try visiting: http://localhost:3001/api/test');
});