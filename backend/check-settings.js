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

async function check() {
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    if (error) {
        console.log('Error or table missing:', error.message);
    } else {
        console.log('Settings table exists!');
    }
    process.exit(0);
}
check();
