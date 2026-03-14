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

async function upgradeGateNotifications() {
    console.log('Upgrading gate_notifications table...');
    const sql = `
        DO $$ 
        BEGIN 
            -- Create table if missing
            CREATE TABLE IF NOT EXISTS gate_notifications (
                id BIGSERIAL PRIMARY KEY,
                visitor_name TEXT,
                visitor_phone TEXT,
                license_plate TEXT,
                visiting_flat TEXT,
                request_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            -- Add type column if missing
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gate_notifications' AND column_name='type') THEN
                ALTER TABLE gate_notifications ADD COLUMN type TEXT DEFAULT 'approval';
            END IF;
        END $$;
    `;
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) {
        console.error('Error upgrading table:', error.message);
        console.log('You might need to run this manually in Supabase SQL Editor:');
        console.log(sql);
    } else {
        console.log('Table upgraded successfully!');
    }
}
upgradeGateNotifications();
