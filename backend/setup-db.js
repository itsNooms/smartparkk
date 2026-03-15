/**
 * SmartParkk - Database Setup Script
 * Run once to create the blocked_visitors table in Supabase.
 * Usage: node setup-db.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { setGlobalDispatcher, Agent } = require('undici');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Bypass Jio DNS blocking (ONLY USE LOCALLY IF NEEDED)
if (process.env.ENABLE_JIO_BYPASS === 'true') {
    const supabaseHostname = new URL(process.env.SUPABASE_URL).hostname;
    setGlobalDispatcher(new Agent({
        connect: {
            lookup: (hostname, options, callback) => {
                if (hostname === supabaseHostname) {
                    callback(null, [{ address: '104.18.39.10', family: 4 }]);
                } else {
                    dns.lookup(hostname, options, (err, address, family) => {
                        if (err) return callback(err);
                        callback(null, [{ address, family }]);
                    });
                }
            }
        }
    }));
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function setup() {
    console.log('\n  SmartParkk — Database Setup\n');

    // Test connection
    console.log('  → Testing Supabase connection...');
    const { data: test, error: testErr } = await supabase.from('residents').select('id').limit(1);
    if (testErr) {
        console.error('  ✗ Connection failed:', testErr.message);
        console.error('  Make sure your Supabase project is active and credentials are correct.');
        process.exit(1);
    }
    console.log('  ✓ Connected to Supabase!\n');

    // Create blocked_visitors table using SQL via RPC
    console.log('  → Creating blocked_visitors table...');
    const createSQL = `
        CREATE TABLE IF NOT EXISTS blocked_visitors (
            id BIGSERIAL PRIMARY KEY,
            resident_flat_id TEXT NOT NULL,
            visitor_phone TEXT NOT NULL,
            visitor_name TEXT,
            blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (resident_flat_id, visitor_phone)
        );
    `;

    const { error: createErr } = await supabase.rpc('exec_sql', { sql: createSQL });

    if (createErr) {
        // If exec_sql RPC doesn't exist, try inserting a dummy row to check table exists
        const { error: checkErr } = await supabase.from('blocked_visitors').select('id').limit(1);
        if (checkErr && checkErr.code === '42P01') {
            console.error('\n  ✗ Table does not exist and could not be created automatically.');
            console.error('\n  Please run this SQL in your Supabase SQL Editor:');
            console.error('  https://supabase.com/dashboard/project/yvgsllvxjidhlaysaprf/sql/new\n');
            console.error('  ─────────────────────────────────────────────────────────────');
            console.error(`
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
            console.error('  ─────────────────────────────────────────────────────────────\n');
            process.exit(1);
        } else if (!checkErr) {
            console.log('  ✓ blocked_visitors table already exists!');
        } else {
            console.error('  ✗ Unexpected error:', checkErr.message);
            process.exit(1);
        }
    } else {
        console.log('  ✓ blocked_visitors table created!');
    }

    // Check if table exists by querying it
    const { error: finalCheck } = await supabase.from('blocked_visitors').select('id').limit(1);
    if (finalCheck) {
        console.error('\n  ✗ Table verification failed:', finalCheck.message);
        process.exit(1);
    }

    console.log('\n  ✅ Setup complete! blocked_visitors table is ready.\n');
    process.exit(0);
}

setup().catch(err => {
    console.error('  ✗ Setup error:', err.message);
    process.exit(1);
});
