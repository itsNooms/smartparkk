require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { setGlobalDispatcher, Agent } = require('undici');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

setGlobalDispatcher(new Agent({
    connect: {
        lookup: (hostname, options, callback) => {
            if (hostname === 'yvgsllvxjidhlaysaprf.supabase.co') {
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function setupPushTable() {
    console.log('Creating push_subscriptions table...');
    const createSQL = `
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGSERIAL PRIMARY KEY,
            flat_id TEXT UNIQUE NOT NULL,
            subscription JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `;
    const { error } = await supabase.rpc('exec_sql', { sql: createSQL });
    if (error) {
        console.error('RPC Error (might need to run manually in Supabase):', error.message);
    } else {
        console.log('Push subscriptions table created via RPC!');
    }
}
setupPushTable();
