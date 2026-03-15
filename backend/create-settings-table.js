require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { setGlobalDispatcher, Agent } = require('undici');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

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

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function setup() {
    console.log('\n  SmartParkk — Settings Table Setup\n');

    const createSQL = `
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Enable RLS
        ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

        -- Create policy if it doesn't exist
        DO $$ 
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies 
                WHERE tablename = 'settings' AND policyname = 'Allow all for anon'
            ) THEN
                CREATE POLICY "Allow all for anon" ON settings FOR ALL USING (true) WITH CHECK (true);
            END IF;
        END $$;
    `;

    console.log('  → Attempting to create settings table...');
    const { error } = await supabase.rpc('exec_sql', { sql: createSQL });

    if (error) {
        console.log('  ✗ RPC failed:', error.message);
        console.log('\n  Please run this SQL in your Supabase SQL Editor manually:');
        console.log('  ─────────────────────────────────────────────────────────────');
        console.log(createSQL);
        console.log('  ─────────────────────────────────────────────────────────────\n');
    } else {
        console.log('  ✓ settings table created/verified successfully!');

        // Seed default value if not exists
        const { data: existing } = await supabase.from('settings').select('key').eq('key', 'smartpark_total_parking').maybeSingle();
        if (!existing) {
            console.log('  → Seeding default capacity (21)...');
            await supabase.from('settings').insert([{ key: 'smartpark_total_parking', value: '21' }]);
        }
        console.log('  ✅ Done!');
    }
    process.exit(0);
}

setup();
