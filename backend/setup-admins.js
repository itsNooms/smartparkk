const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function setupAdmins() {
    console.log('\n  SmartParkk — Admin Table Setup\n');

    const sql = `
CREATE TABLE IF NOT EXISTS admins (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'admins' AND policyname = 'Allow all for anon'
    ) THEN
        CREATE POLICY "Allow all for anon" ON admins FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
    `;

    console.log('  → Creating admins table in Supabase...');

    // Try to use RPC if available
    const { error: rpcError } = await supabase.rpc('exec_sql', { sql });

    if (rpcError) {
        console.log('  ⚠  Automatic table creation failed (RPC "exec_sql" missing).');
        console.log('  Please run the following SQL manually in your Supabase SQL Editor:');
        console.log('  https://supabase.com/dashboard/project/yvgsllvxjidhlaysaprf/sql/new\n');
        console.log('  ─────────────────────────────────────────────────────────────');
        console.log(sql);
        console.log('  ─────────────────────────────────────────────────────────────\n');

        // Final check if table already exists
        const { error: checkError } = await supabase.from('admins').select('id').limit(1);
        if (!checkError) {
            console.log('  ✓ However, the "admins" table already exists! You are good to go.');
        } else {
            process.exit(1);
        }
    } else {
        console.log('  ✅ Admin table setup complete!');
    }

    process.exit(0);
}

setupAdmins().catch(err => {
    console.error('  ✗ Error:', err.message);
    process.exit(1);
});
