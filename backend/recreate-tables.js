/**
 * SmartParkk — Table Recreator
 * Recreates visitor_requests and blocked_visitors tables.
 * Usage: node recreate-tables.js
 */

require('dotenv').config();
const https = require('https');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const PROJECT_REF = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.split('//')[1].split('.')[0] : 'yvgsllvxjidhlaysaprf';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function post(path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: `${PROJECT_REF}.supabase.co`,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${ANON_KEY}`,
                'Content-Length': Buffer.byteLength(data),
                ...headers
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, body }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: `${PROJECT_REF}.supabase.co`,
            path,
            method: 'GET',
            headers: {
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${ANON_KEY}`
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, body }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function checkTable(tableName) {
    const result = await get(`/rest/v1/${tableName}?limit=1`);
    if (result.status === 200 || result.status === 206) return true;
    if (result.status === 404 || (result.body && result.body.code === '42P01')) return false;
    if (typeof result.body === 'object' && result.body.code === '42P01') return false;
    // Check message
    const msg = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    if (msg.includes('42P01') || msg.includes('does not exist')) return false;
    return null; // unknown
}

async function main() {
    console.log('\n  SmartParkk — Table Recreator\n');

    // Check visitor_requests
    console.log('  Checking visitor_requests table...');
    const vrExists = await checkTable('visitor_requests');

    // Check blocked_visitors
    console.log('  Checking blocked_visitors table...');
    const bvExists = await checkTable('blocked_visitors');

    console.log('');
    if (vrExists === true) console.log('  ✓ visitor_requests — EXISTS');
    else console.log('  ✗ visitor_requests — MISSING');

    if (bvExists === true) console.log('  ✓ blocked_visitors — EXISTS');
    else console.log('  ✗ blocked_visitors — MISSING');

    const missing = [];
    if (!vrExists) missing.push('visitor_requests');
    if (!bvExists) missing.push('blocked_visitors');

    if (missing.length === 0) {
        console.log('\n  ✅ All tables exist! No action needed.\n');
        return;
    }

    console.log('\n  ──────────────────────────────────────────────────────────');
    console.log('  📋 Run this SQL in your Supabase SQL Editor:');
    console.log('  https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new');
    console.log('  ──────────────────────────────────────────────────────────\n');

    if (!vrExists) {
        console.log(`-- ① visitor_requests table
CREATE TABLE IF NOT EXISTS visitor_requests (
    id TEXT PRIMARY KEY,
    visitor_name TEXT,
    visitor_phone TEXT,
    license_plate TEXT,
    visiting_flat TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ
);

ALTER TABLE visitor_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON visitor_requests
    FOR ALL
    USING (true)
    WITH CHECK (true);
`);
    }

    if (!bvExists) {
        console.log(`-- ② blocked_visitors table
CREATE TABLE IF NOT EXISTS blocked_visitors (
    id BIGSERIAL PRIMARY KEY,
    resident_flat_id TEXT NOT NULL,
    visitor_phone TEXT NOT NULL,
    visitor_name TEXT,
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resident_flat_id, visitor_phone)
);

ALTER TABLE blocked_visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON blocked_visitors
    FOR ALL
    USING (true)
    WITH CHECK (true);
`);
    }

    console.log('  ──────────────────────────────────────────────────────────\n');
}

main().catch(err => {
    console.error('  Error:', err.message);
});
