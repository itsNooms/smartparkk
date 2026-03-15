require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const dns = require('dns');
const fs = require('fs');
const webpush = require('web-push');

// ============================================
// WHATSAPP SESSION STORE (Supabase-based)
// ============================================
class SupabaseSessionStore {
    constructor(supabase) {
        this.supabase = supabase;
        this.sessionKey = 'whatsapp-session-main';
    }

    async read() {
        try {
            const { data, error } = await this.supabase
                .from('whatsapp_sessions')
                .select('session_data')
                .eq('key', this.sessionKey)
                .single();

            if (error || !data) {
                console.log('📱 No WhatsApp session found in database');
                return null;
            }

            console.log('📱 WhatsApp session loaded from database');
            return data.session_data;
        } catch (e) {
            console.error('Error reading session from database:', e.message);
            return null;
        }
    }

    async write(data) {
        try {
            const { error } = await this.supabase
                .from('whatsapp_sessions')
                .upsert({
                    key: this.sessionKey,
                    session_data: data,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                console.error('Error saving session to database:', error.message);
            } else {
                console.log('📱 WhatsApp session saved to database');
            }
        } catch (e) {
            console.error('Error saving session:', e.message);
        }
    }
}

// ============================================
// WEB PUSH CONFIG
// ============================================
webpush.setVapidDetails(
    'mailto:admin@smartparkk.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');
function getSubscriptions() {
    try {
        if (!fs.existsSync(SUBSCRIPTIONS_FILE)) return {};
        return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE));
    } catch (e) { return {}; }
}
function saveSubscription(flatId, sub) {
    const subs = getSubscriptions();
    subs[flatId] = sub;
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
}

// Bypassing Jio DNS Blocking for Supabase (ONLY USE IF NEEDED LOCALLY)
if (process.env.ENABLE_JIO_BYPASS === 'true') {
    const { setGlobalDispatcher, Agent } = require('undici');
    dns.setDefaultResultOrder('ipv4first');
    const supabaseHostname = new URL(process.env.SUPABASE_URL).hostname;

    console.log(`[DNS] Enabling Jio bypass for ${supabaseHostname}`);

    setGlobalDispatcher(new Agent({
        connect: {
            lookup: (hostname, options, callback) => {
                if (hostname === supabaseHostname) {
                    // This IP is a common Cloudflare IP for Supabase, but it can change.
                    // Only use this if you are absolutely sure you are being blocked.
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

// ============================================
// SUPABASE CONFIG
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('\n  ✗ ERROR: SUPABASE_URL or SUPABASE_ANON_KEY is missing!');
    console.error('    Please configure these environment variables in your hosting platform.\n');
}

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to check if Supabase is initialized
app.use('/api', (req, res, next) => {
    if (!supabase) {
        return res.status(503).json({
            success: false,
            message: 'Database connection not initialized. Please configure SUPABASE_URL and SUPABASE_ANON_KEY.'
        });
    }
    next();
});

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// Standard frontend routes
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/login', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'admin.html')));
app.get('/resident', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'resident.html')));

// Health check for deployment verification
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        env: {
            node_env: process.env.NODE_ENV || 'development',
            supabase_set: !!SUPABASE_URL,
            wa_ready: waReady
        },
        database: 'Checking...'
    };

    if (!supabase) {
        health.database = 'Error: Supabase client not initialized (missing keys)';
    } else {
        try {
            const { error } = await supabase.from('residents').select('id').limit(1);
            health.database = error ? `Error: ${error.message}` : 'Connected';
        } catch (e) {
            health.database = `Error: ${e.message}`;
        }
    }

    res.json(health);
});

// QR Code Endpoint
app.get('/api/qr', async (req, res) => {
    if (waReady) {
        return res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; text-align: center;">
                <h1 style="color: #25D366;">✓ WhatsApp is Connected!</h1>
                <p>You can now close this tab and start using the app.</p>
                <button onclick="window.close()" style="padding: 10px 20px; background: #25D366; color: white; border: none; border-radius: 5px; cursor: pointer; margin-top: 20px;">Close Tab</button>
            </div>
        `);
    }
    if (!latestQR) {
        return res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; text-align: center;">
                <h1>Initializing WhatsApp...</h1>
                <p>The server is starting the WhatsApp client. This page will refresh automatically in 5 seconds.</p>
                <div style="width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #25D366; border-radius: 50%; animate: spin 2s linear infinite;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                <script>setTimeout(()=>location.reload(), 5000)</script>
            </div>
        `);
    }

    try {
        const qrImage = await QRCode.toDataURL(latestQR);
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; text-align: center; background: #f0f2f5;">
                <h1 style="color: #25D366;">Scan for WhatsApp Connection</h1>
                <p>Open WhatsApp on your phone &rarr; Linked Devices &rarr; Link a Device</p>
                <div style="background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
                    <img src="${qrImage}" style="width: 300px; height: 300px;" />
                </div>
                <p style="margin-top: 20px; color: #666;">This page will automatically refresh once connected.</p>
                <script>
                    setInterval(async () => {
                        try {
                            const res = await fetch('/api/health');
                            const data = await res.json();
                            if (data.env.wa_ready) location.reload();
                        } catch(e) {}
                    }, 3000);
                </script>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

// ============================================
// SETTINGS API (SUPABASE)
// ============================================

// Get all settings
app.get('/api/settings', async (req, res) => {
    try {
        const { data, error } = await supabase.from('settings').select('*');
        if (error) {
            // Table might not exist yet, return empty array (defaults will be used)
            console.warn('[SETTINGS] Fetch error (likely table missing):', error.message);
            return res.json([]);
        }
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update or create a setting
app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ success: false, message: 'key is required' });

    try {
        // Upsert setting
        const { data, error } = await supabase
            .from('settings')
            .upsert([{ key, value, updated_at: new Date().toISOString() }], { onConflict: 'key' })
            .select();

        if (error) {
            console.error('[SETTINGS] Update error:', error.message);
            return res.status(500).json({ success: false, message: error.message });
        }
        res.json({ success: true, setting: data[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// WHATSAPP OTP
// ============================================
const otpStore = {};  // phone -> { otp, expiresAt }
let waReady = false;
let latestQR = null;
let whatsappSessionStore = null;

const waClient = new Client({
    authStrategy: new LocalAuth({
        clientId: 'smartparkk-whatsapp',
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu'
        ],
        headless: true,
        executablePath: (process.env.PUPPETEER_EXECUTABLE_PATH && process.env.PUPPETEER_EXECUTABLE_PATH.trim() !== '')
            ? process.env.PUPPETEER_EXECUTABLE_PATH
            : undefined
    }
});

waClient.on('authenticated', async (session) => {
    console.log('  ✓  WhatsApp authenticated. Saving session to database...');
    if (whatsappSessionStore) {
        await whatsappSessionStore.write(session);
    }
});

waClient.on('qr', (qr) => {
    latestQR = qr;
    console.log('\n  [WhatsApp] Scan this QR code with your WhatsApp:');
    console.log('  (Open WhatsApp → Linked Devices → Link a Device)');
    console.log('  👉 OR OPEN IN BROWSER: ' + (process.env.RAILWAY_STATIC_URL || 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN || 'your-url') + '/api/qr');
    console.log('  --------------------------------------------------\n');
    qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
    waReady = true;
    latestQR = null;
    console.log('\n  ✓  WhatsApp connected! OTPs will be sent via WhatsApp.\n');
});

waClient.on('auth_failure', (msg) => {
    console.error('  ✗  WhatsApp auth failed:', msg);
});

waClient.on('disconnected', () => {
    waReady = false;
    console.warn('  ⚠  WhatsApp disconnected. Will try to restore session...');
});

// ── WhatsApp inbound message handler (EXTEND replies) ───────────────────────
waClient.on('message', async (msg) => {
    const text = msg.body.trim().toUpperCase();
    const senderPhone = msg.from.replace('@c.us', '').slice(-10);

    const extendMatch = text.match(/^EXTEND\s+(\d+)$/);
    if (!extendMatch) return; // Not an EXTEND command — ignore

    const additionalHours = parseInt(extendMatch[1]);
    if (additionalHours < 1 || additionalHours > 5) {
        await msg.reply('❌ Please reply with EXTEND 1, EXTEND 2, or EXTEND 3 to add hours.');
        return;
    }

    // Find active visitor
    const { data: visitors, error } = await supabase
        .from('visitors')
        .select('*')
        .is('exit_time', null)
        .order('entry_time', { ascending: false });

    if (error || !visitors) {
        await msg.reply('❌ Sorry, could not process. Please contact gate staff.');
        return;
    }

    const visitor = visitors.find(v =>
        v.phone && v.phone.replace(/\D/g, '').slice(-10) === senderPhone
    );

    if (!visitor) {
        await msg.reply('❌ No active parking session found for your number.');
        return;
    }

    const newEstimatedHours = (visitor.estimated_hours || 4) + additionalHours;
    const additionalCharge = (additionalHours * (visitor.rate_per_hour || 5)).toFixed(2);
    const newEndTime = new Date(new Date(visitor.entry_time).getTime() + newEstimatedHours * 3600000);
    const endTimeStr = newEndTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const { error: updateErr } = await supabase
        .from('visitors')
        .update({ estimated_hours: newEstimatedHours, extension_notified_at: null })
        .eq('id', visitor.id);

    if (updateErr) {
        await msg.reply('❌ Could not update parking. Please contact gate staff.');
        return;
    }

    console.log(`[EXTEND-WA] ${visitor.name} +${additionalHours}h → ${newEstimatedHours}h total`);

    await msg.reply(
        `✅ *Parking Extended!*\n\n` +
        `Added *${additionalHours} hour${additionalHours > 1 ? 's' : ''}* to your session.\n\n` +
        `📅 New estimated end: *${endTimeStr}*\n` +
        `💰 Extra charge: *₹${additionalCharge}*\n\n` +
        `You'll get another reminder 30 min before your new end time.\n` +
        `🚗 ${visitor.license_plate}`
    );
});

function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// POST /api/send-otp
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;

    if (!phone || phone.length < 10) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const otp = generateOTP();
    otpStore[cleanPhone] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };

    if (waReady) {
        try {
            // Smart phone formatting: 
            // If 10 digits, assume India (+91). If more, use as is (assuming country code provided).
            const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
            const chatId = `${fullPhone}@c.us`;

            await waClient.sendMessage(chatId,
                `🔐 *SmartParkk OTP*\n\nYour OTP is: *${otp}*\n\n💡 *Parking Charges:*\nIf you exceed your parking duration, a ₹50 fine will be applied.\n\n_Expires in 5 minutes. Do not share this._`);

            console.log(`[WhatsApp OTP] Sent ${otp} → ${fullPhone}`);
            return res.json({ success: true, message: 'OTP sent to your WhatsApp!' });
        } catch (err) {
            console.error('[WhatsApp Error]', err.message);
            if (err.message.includes('detached Frame') || err.message.includes('Target closed')) {
                waReady = false;
                console.log('⚠ Restoring WhatsApp client due to browser frame disconnect...');
                try {
                    await waClient.destroy();
                } catch (e) { }
                waClient.initialize();
            }
            // Fall through to on-screen fallback
        }
    }

    // WhatsApp not connected yet — show on screen
    console.log(`[OTP] ${otp} for ${cleanPhone} — WhatsApp not ready, showing on screen.`);
    return res.json({
        success: true,
        demo: true,
        otp,
        message: waReady ? 'WhatsApp send failed. OTP shown below.' : 'WhatsApp not connected. OTP shown below.'
    });
});

// POST /api/verify-otp
app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ success: false, message: 'Phone and OTP required' });
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const stored = otpStore[cleanPhone];

    if (!stored) {
        return res.json({ success: false, message: 'No OTP found for this number. Request a new one.' });
    }

    if (Date.now() > stored.expiresAt) {
        delete otpStore[cleanPhone];
        return res.json({ success: false, message: 'OTP expired. Request a new one.' });
    }

    if (stored.otp === otp) {
        delete otpStore[cleanPhone];
        return res.json({ success: true, message: 'OTP verified successfully' });
    }

    return res.json({ success: false, message: 'Invalid OTP. Try again.' });
});

// ============================================
// DATABASE API ENDPOINTS (SUPABASE)
// ============================================

// Get all residents
app.get('/api/residents', async (req, res) => {
    const { data, error } = await supabase.from('residents').select('*');
    if (error) return res.status(500).json({ success: false, message: error.message });

    // Map DB column names to frontend-expected camelCase
    const mapped = (data || []).map(r => ({
        id: r.id,
        name: r.name,
        flatInput: r.flat_input,
        baseFlatId: r.base_flat_id,
        role: r.role,
        phone: r.phone,
        carPlate: r.car_plate,
        password: r.password,
        isAvailable: r.is_available
    }));
    res.json(mapped);
});

// Register a resident
app.post('/api/residents', async (req, res) => {
    const b = req.body;
    const { data, error } = await supabase.from('residents').insert([{
        id: b.id,
        name: b.name,
        flat_input: b.flatInput,
        base_flat_id: b.baseFlatId,
        role: b.role,
        phone: b.phone,
        car_plate: b.carPlate || 'N/A',
        password: b.password,
        is_available: b.isAvailable !== undefined ? b.isAvailable : true
    }]).select();

    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, resident: b });
});

// Update a resident (password, availability, or car plates)
app.post('/api/residents/update', async (req, res) => {
    const { flatInput, password, isAvailable, carPlate } = req.body;

    const updates = {};
    if (password !== undefined) updates.password = password;
    if (isAvailable !== undefined) updates.is_available = isAvailable;
    if (carPlate !== undefined) updates.car_plate = carPlate;

    const { data, error } = await supabase
        .from('residents')
        .update(updates)
        .eq('flat_input', flatInput)
        .select();

    if (error) return res.status(500).json({ success: false, message: error.message });
    if (!data || data.length === 0) return res.status(404).json({ success: false, message: 'Resident not found' });

    res.json({ success: true, resident: data[0] });
});

app.get('/api/visitors', async (req, res) => {
    const { data, error } = await supabase.from('visitors').select('*');
    if (error) {
        console.error('Fetch error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }

    const mapped = (data || []).map(v => ({
        id: v.id,
        name: v.name,
        phone: v.phone,
        licensePlate: v.license_plate,
        visitingFlat: v.visiting_flat,
        entryTime: v.entry_time,
        exitTime: v.exit_time,
        ratePerHour: v.rate_per_hour,
        totalCharge: v.total_charge,
        estimatedHours: v.estimated_hours || 4,
        extensionNotifiedAt: v.extension_notified_at || null
    }));
    res.json(mapped);
});

// Add a visitor (entry)
app.post('/api/visitors', async (req, res) => {
    const b = req.body;
    
    // Check if this plate is already in the system (no exit_time)
    const { data: existingVisitor } = await supabase
        .from('visitors')
        .select('id')
        .eq('license_plate', b.licensePlate)
        .is('exit_time', null)
        .limit(1);

    if (existingVisitor && existingVisitor.length > 0) {
        return res.status(400).json({ 
            success: false, 
            message: `Vehicle with plate ${b.licensePlate} is already parked. Please scan again to exit.` 
        });
    }
    
    const { data, error } = await supabase.from('visitors').insert([{
        id: b.id || Date.now().toString(),
        name: b.name,
        phone: b.phone,
        license_plate: b.licensePlate,
        visiting_flat: b.visitingFlat,
        entry_time: b.entryTime || new Date().toISOString(),
        exit_time: b.exitTime || null,
        rate_per_hour: b.ratePerHour || 5,
        total_charge: b.totalCharge || 0,
        estimated_hours: b.estimatedHours || 4,
        extension_notified_at: null
    }]).select();

    if (error) return res.status(500).json({ success: false, message: error.message });

    // Auto-dismiss any pending gate notifications for this license plate
    try {
        await supabase
            .from('gate_notifications')
            .update({ status: 'opened', opened_at: new Date().toISOString() })
            .eq('license_plate', b.licensePlate)
            .eq('status', 'pending');
        console.log(`[GATE] Auto-dismissed notifications for plate ${b.licensePlate} (visitor entered)`);
    } catch (notifErr) {
        console.error('[GATE] Failed auto-dismiss:', notifErr);
    }

    res.json({ success: true, visitor: b });
});

// Update visitor (exit time and charge)
app.post('/api/visitors/update', async (req, res) => {
    const { id, exitTime, totalCharge } = req.body;

    const updates = {};
    if (exitTime !== undefined) updates.exit_time = exitTime;
    if (totalCharge !== undefined) updates.total_charge = totalCharge;

    const { data, error } = await supabase
        .from('visitors')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) return res.status(500).json({ success: false, message: error.message });
    if (!data || data.length === 0) return res.status(404).json({ success: false, message: 'Visitor not found' });

    res.json({ success: true, visitor: data[0] });
});

// Extend visitor stay (can also be called from WhatsApp handler)
app.post('/api/visitors/extend', async (req, res) => {
    const { phone, additionalHours } = req.body;
    if (!phone || !additionalHours) {
        return res.status(400).json({ success: false, message: 'phone and additionalHours are required' });
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const extra = Math.min(Math.max(parseInt(additionalHours), 1), 5); // clamp 1-5

    // Find the most recent active visitor with this phone
    const { data: visitors, error: fetchErr } = await supabase
        .from('visitors')
        .select('*')
        .is('exit_time', null)
        .order('entry_time', { ascending: false });

    if (fetchErr) return res.status(500).json({ success: false, message: fetchErr.message });

    const visitor = (visitors || []).find(v =>
        v.phone && v.phone.replace(/\D/g, '').slice(-10) === cleanPhone
    );

    if (!visitor) return res.status(404).json({ success: false, message: 'No active parking session found for this phone.' });

    const newEstimatedHours = (visitor.estimated_hours || 4) + extra;

    const { error: updateErr } = await supabase
        .from('visitors')
        .update({ estimated_hours: newEstimatedHours, extension_notified_at: null })
        .eq('id', visitor.id);

    if (updateErr) return res.status(500).json({ success: false, message: updateErr.message });

    console.log(`[EXTEND] ${visitor.name} (+${extra}h) → ${newEstimatedHours}h total`);
    res.json({ success: true, newEstimatedHours, visitorName: visitor.name });
});

// ============================================
// VISITOR REQUEST / APPROVAL ENDPOINTS (SUPABASE)
// ============================================

// Create a visitor request
app.post('/api/visitor-requests', async (req, res) => {
    const spotSuffix = req.body.selectedSpot ? `-${req.body.selectedSpot}` : '';
    const hoursSuffix = req.body.estimatedHours ? `-H${req.body.estimatedHours}` : '';
    const requestData = {
        id: Date.now().toString() + spotSuffix + hoursSuffix,
        visitor_name: req.body.visitorName,
        visitor_phone: req.body.visitorPhone,
        license_plate: req.body.licensePlate,
        visiting_flat: req.body.visitingFlat,
        status: 'pending'
    };

    const { data, error } = await supabase.from('visitor_requests').insert([requestData]).select();
    if (error) return res.status(500).json({ success: false, message: error.message });

    console.log(`[REQUEST] New visitor request from ${req.body.visitorName} for flat ${req.body.visitingFlat}`);

    // Return in camelCase format for frontend
    const request = {
        id: requestData.id,
        visitorName: requestData.visitor_name,
        visitorPhone: requestData.visitor_phone,
        licensePlate: requestData.license_plate,
        visitingFlat: requestData.visiting_flat,
        status: requestData.status,
        createdAt: data[0].created_at
    };

    // TRIGGER PUSH NOTIFICATION
    const subs = getSubscriptions();
    const sub = subs[request.visitingFlat.toUpperCase()];
    if (sub) {
        const payload = JSON.stringify({
            title: '🔔 New Visitor Request!',
            body: `${request.visitorName} (${request.licensePlate}) is waiting for your approval.`,
            icon: '/logo.png',
            badge: '/logo.png',
            vibrate: [100, 50, 100, 50, 200],
            tag: 'smartparkk-visitor',
            renotify: true,
            requireInteraction: true,
            data: { 
                url: '/resident',
                requestId: request.id,
                visitorName: request.visitorName,
                licensePlate: request.licensePlate,
                visitingFlat: request.visitingFlat
            }
        });
        
        // Send push notification with options
        const options = {
            TTL: 60 * 60, // 1 hour
            urgency: 'high'
        };
        
        webpush.sendNotification(sub, payload, options)
            .then(() => console.log(`✅ Push notification sent to ${request.visitingFlat}`))
            .catch(err => console.error('[PUSH ERROR]', err));
    }

    res.json({ success: true, request });
});

// Save Push Subscription
app.post('/api/subscribe', (req, res) => {
    const { flatId, subscription } = req.body;
    if (!flatId || !subscription) return res.status(400).json({ success: false });
    saveSubscription(flatId.toUpperCase(), subscription);
    res.json({ success: true });
});

// Get VAPID public key for frontend
app.get('/api/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Get pending requests for a specific flat
app.get('/api/visitor-requests', async (req, res) => {
    const flatId = req.query.flatId;
    const status = req.query.status; // Optional: filter by status

    // Always get ALL requests, then filter in JS for base flat matching
    let query = supabase.from('visitor_requests').select('*');
    
    // If status is specified, filter by it
    if (status) {
        query = query.eq('status', status);
    }
    
    // Sort by most recent first
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, message: error.message });

    let results = (data || []).map(r => ({
        id: r.id,
        visitorName: r.visitor_name,
        visitorPhone: r.visitor_phone,
        licensePlate: r.license_plate,
        visitingFlat: r.visiting_flat,
        status: r.status,
        createdAt: r.created_at,
        respondedAt: r.responded_at
    }));

    if (flatId) {
        const targetFlat = flatId.replace(/T$/i, '').toUpperCase();
        results = results.filter(r => {
            const reqFlat = r.visitingFlat.replace(/T$/i, '').toUpperCase();
            return reqFlat === targetFlat;
        });
    }

    res.json(results);
});

// Approve or reject a visitor request
app.post('/api/visitor-requests/respond', async (req, res) => {
    const { requestId, action } = req.body;

    const { data, error } = await supabase
        .from('visitor_requests')
        .update({ status: action, responded_at: new Date().toISOString() })
        .eq('id', requestId)
        .select();

    if (error) return res.status(500).json({ success: false, message: error.message });
    if (!data || data.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });

    console.log(`[REQUEST] Visitor request ${requestId} was ${action}`);

    const request = data[0];
    
    res.json({ 
        success: true, 
        request: {
            id: request.id,
            visitorName: request.visitor_name,
            status: request.status
        }
    });
});


// Poll status of a specific request
app.get('/api/visitor-requests/:id', async (req, res) => {
    const { data, error } = await supabase
        .from('visitor_requests')
        .select('*')
        .eq('id', req.params.id)
        .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Request not found' });

    res.json({
        id: data.id,
        visitorName: data.visitor_name,
        visitorPhone: data.visitor_phone,
        licensePlate: data.license_plate,
        visitingFlat: data.visiting_flat,
        status: data.status,
        createdAt: data.created_at,
        respondedAt: data.responded_at
    });
});

// ============================================
// GATE NOTIFICATIONS (SUPABASE)
// ============================================

// Get all pending gate notifications (admin polls this)
app.get('/api/gate-notifications', async (req, res) => {
    const { data, error } = await supabase
        .from('gate_notifications')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ success: false, message: error.message });

    res.json((data || []).map(n => ({
        id: n.id,
        visitorName: n.visitor_name,
        visitorPhone: n.visitor_phone,
        licensePlate: n.license_plate,
        visitingFlat: n.visiting_flat,
        requestId: n.request_id,
        status: n.status,
        type: n.type || 'approved', // Include type, default to 'approved' for older entries
        createdAt: n.created_at
    })));
});

// Admin dismisses (opens gate) for a notification
app.post('/api/gate-notifications/dismiss', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'id is required' });

    const { data, error } = await supabase
        .from('gate_notifications')
        .update({ status: 'opened', opened_at: new Date().toISOString() })
        .eq('id', id)
        .select();

    if (error) return res.status(500).json({ success: false, message: error.message });

    console.log(`[GATE] Admin opened gate for notification #${id}`);
    res.json({ success: true });
});

// Trigger a gate notification (called after camera validation)
app.post('/api/gate-notifications/trigger', async (req, res) => {
    let { requestId, licensePlate, visitingFlat, visitorName, visitorPhone, type } = req.body;

    // Normalize for robust deduplication
    if (licensePlate) licensePlate = licensePlate.trim().toUpperCase();
    if (visitingFlat) visitingFlat = visitingFlat.trim().toUpperCase();

    // 1. First, check for ANY existing notification for this EXACT requestId
    // This handles the case where the visitor app might re-trigger for the same request.
    const { data: existingByRequest } = await supabase
        .from('gate_notifications')
        .select('id, status')
        .eq('request_id', requestId)
        .limit(1);

    if (existingByRequest && existingByRequest.length > 0) {
        console.log(`[GATE NOTIF] Already exists for request ${requestId} (Status: ${existingByRequest[0].status})`);
        return res.json({
            success: true,
            notificationId: existingByRequest[0].id,
            alreadyExists: true,
            status: existingByRequest[0].status
        });
    }

    // 2. Second, check for a RECENT notification for this plate + flat (last 5 mins)
    // This handles the case where the visitor might have refreshed and got a new requestId,
    // or the camera triggered twice for the same car.
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentByPlate } = await supabase
        .from('gate_notifications')
        .select('id, status')
        .eq('license_plate', licensePlate)
        .eq('visiting_flat', visitingFlat)
        .gt('created_at', fiveMinsAgo)
        .limit(1);

    if (recentByPlate && recentByPlate.length > 0) {
        console.log(`[GATE NOTIF] Recent notification found for ${licensePlate} → ${visitingFlat}`);
        return res.json({
            success: true,
            notificationId: recentByPlate[0].id,
            alreadyExists: true,
            status: recentByPlate[0].status
        });
    }

    const notif = {
        visitor_name: visitorName,
        visitor_phone: visitorPhone,
        license_plate: licensePlate,
        visiting_flat: visitingFlat,
        request_id: requestId,
        status: 'pending',
        type: type || 'approved',
        created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('gate_notifications').insert([notif]).select();
    if (error) return res.status(500).json({ success: false, message: error.message });

    console.log(`[GATE NOTIF] Triggered by camera: ${licensePlate} for request ${requestId}`);
    res.json({
        success: true,
        notificationId: String(data[0].id),
        status: data[0].status
    });
});

// Get notification status (for visitor app polling by requestId)
app.get('/api/gate-notifications/status-by-request/:requestId', async (req, res) => {
    const { data, error } = await supabase
        .from('gate_notifications')
        .select('status')
        .eq('request_id', req.params.requestId)
        .order('created_at', { ascending: false })
        .limit(1);

    if (error || !data || data.length === 0) {
        return res.json({ success: true, status: 'not_triggered' });
    }
    res.json({ success: true, status: data[0].status });
});

// Get notification status (for resident app polling)
app.get('/api/gate-notifications/:id/status', async (req, res) => {
    const { data, error } = await supabase
        .from('gate_notifications')
        .select('status')
        .eq('id', req.params.id)
        .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, status: data.status });
});

// ============================================
// BLOCKED VISITORS (SUPABASE)
// ============================================

// Get all blocked visitors for a resident flat
app.get('/api/blocked-visitors', async (req, res) => {
    const { flatId } = req.query;
    if (!flatId) return res.status(400).json({ success: false, message: 'flatId is required' });

    const baseFlatId = flatId.replace(/T$/i, '').toUpperCase();

    const { data, error } = await supabase
        .from('blocked_visitors')
        .select('*')
        .eq('resident_flat_id', baseFlatId)
        .order('blocked_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, message: error.message });

    res.json((data || []).map(b => ({
        id: b.id,
        residentFlatId: b.resident_flat_id,
        visitorPhone: b.visitor_phone,
        visitorName: b.visitor_name,
        blockedAt: b.blocked_at
    })));
});

// Get ALL blocked visitors (admin-wide view)
app.get('/api/blocked-visitors/all', async (req, res) => {
    const { data, error } = await supabase
        .from('blocked_visitors')
        .select('*')
        .order('blocked_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, message: error.message });

    res.json((data || []).map(b => ({
        id: b.id,
        residentFlatId: b.resident_flat_id,
        visitorPhone: b.visitor_phone,
        visitorName: b.visitor_name,
        blockedAt: b.blocked_at
    })));
});

// Check if a visitor is blocked for a specific flat
app.get('/api/blocked-visitors/check', async (req, res) => {
    const { flatId, phone } = req.query;
    if (!flatId || !phone) return res.status(400).json({ success: false, message: 'flatId and phone are required' });

    const baseFlatId = flatId.replace(/T$/i, '').toUpperCase();
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);

    const { data, error } = await supabase
        .from('blocked_visitors')
        .select('id')
        .eq('resident_flat_id', baseFlatId)
        .eq('visitor_phone', cleanPhone)
        .maybeSingle();

    if (error) return res.status(500).json({ success: false, message: error.message });

    res.json({ blocked: !!data });
});

// Check if a visitor has an active session currently
app.post('/api/check-active', async (req, res) => {
    const { phone, licensePlate } = req.body;
    if (!phone || !licensePlate) return res.status(400).json({ success: false, message: 'Missing fields' });

    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const cleanPlate = licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    const { data: visitors, error } = await supabase
        .from('visitors')
        .select('*')
        .is('exit_time', null);

    if (error) return res.status(500).json({ success: false, message: error.message });

    const duplicate = (visitors || []).find(v => {
        const vPhone = v.phone ? v.phone.replace(/\D/g, '').slice(-10) : '';
        const vPlate = v.license_plate ? v.license_plate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
        return vPhone === cleanPhone || vPlate === cleanPlate;
    });

    if (duplicate) {
        const type = (duplicate.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone ? 'Phone Number' : 'License Plate';
        return res.json({
            success: true,
            isActive: true,
            message: `A visitor with this <strong>${type}</strong> is already parked inside. Please check the License Plate and Phone Number.`
        });
    }

    res.json({ success: true, isActive: false });
});

// Block a visitor
app.post('/api/blocked-visitors', async (req, res) => {
    const { residentFlatId, visitorPhone, visitorName } = req.body;
    if (!residentFlatId || !visitorPhone) {
        return res.status(400).json({ success: false, message: 'residentFlatId and visitorPhone are required' });
    }

    const baseFlatId = residentFlatId.replace(/T$/i, '').toUpperCase();
    const cleanPhone = visitorPhone.replace(/\D/g, '').slice(-10);

    const { data, error } = await supabase
        .from('blocked_visitors')
        .upsert([{
            resident_flat_id: baseFlatId,
            visitor_phone: cleanPhone,
            visitor_name: visitorName || null,
            blocked_at: new Date().toISOString()
        }], { onConflict: 'resident_flat_id,visitor_phone' })
        .select();

    if (error) return res.status(500).json({ success: false, message: error.message });

    console.log(`[BLOCK] Resident ${baseFlatId} blocked visitor ${visitorName || cleanPhone}`);

    // We no longer trigger block notifications for the admin here.
    // The requirement is that notifications are only sent after camera validation.
    console.log(`[BLOCK] Resident ${baseFlatId} blocked visitor ${cleanPhone}. No notification sent.`);

    res.json({ success: true, block: data[0] });
});

// Unblock a visitor
app.delete('/api/blocked-visitors', async (req, res) => {
    const { residentFlatId, visitorPhone } = req.body;
    if (!residentFlatId || !visitorPhone) {
        return res.status(400).json({ success: false, message: 'residentFlatId and visitorPhone are required' });
    }

    const baseFlatId = residentFlatId.replace(/T$/i, '').toUpperCase();
    const cleanPhone = visitorPhone.replace(/\D/g, '').slice(-10);

    const { error } = await supabase
        .from('blocked_visitors')
        .delete()
        .eq('resident_flat_id', baseFlatId)
        .eq('visitor_phone', cleanPhone);

    if (error) return res.status(500).json({ success: false, message: error.message });

    console.log(`[UNBLOCK] Resident ${baseFlatId} unblocked visitor ${cleanPhone}`);
    res.json({ success: true });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`\n  SmartParkk Server running at:`);
    console.log(`  → Visitor:  http://localhost:${PORT}`);
    console.log(`  → Resident: http://localhost:${PORT}/resident`);
    console.log(`  → Admin:    http://localhost:${PORT}/admin`);
    console.log(`  ✓  Database: Supabase (Cloud)\n`);

    console.log('  ✓  WhatsApp OTP mode active.');
    
    // Initialize session store after supabase is ready
    if (supabase) {
        whatsappSessionStore = new SupabaseSessionStore(supabase);
        console.log('📱 WhatsApp session store initialized');
        
        // Try to restore session from database
        try {
            const savedSession = await whatsappSessionStore.read();
            if (savedSession) {
                console.log('  ✓  WhatsApp session found in database, restoring...');
            } else {
                console.log('  ➤  No saved session. Scan the QR code when it appears.\n');
            }
        } catch (e) {
            console.log('  ➤  No saved session. Scan the QR code when it appears.\n');
        }
    } else {
        console.log('  ➤  No Supabase connection. Using local session only.\n');
    }
    
    waClient.initialize();
});

// ============================================
// PARKING EXPIRY NOTIFICATION JOB
// ============================================
async function checkParkingExpiryNotifications() {
    if (!waReady) return; // Only run when WhatsApp is connected

    try {
        const { data: visitors, error } = await supabase
            .from('visitors')
            .select('*')
            .is('exit_time', null);

        if (error || !visitors || visitors.length === 0) return;

        const now = Date.now();
        const TEN_MIN_MS = 10 * 60 * 1000;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        for (const visitor of visitors) {
            if (!visitor.entry_time || !visitor.phone) continue;

            const entryMs = new Date(visitor.entry_time).getTime();
            const ageMs = now - entryMs;
            if (ageMs > ONE_DAY_MS) continue; // Stale record

            const estimatedHours = visitor.estimated_hours || 4;
            const estimatedEndMs = entryMs + estimatedHours * 3600000;
            const timeLeft = estimatedEndMs - now;

            // Only notify in the 10-minute warning window
            if (timeLeft > TEN_MIN_MS || timeLeft < 0) continue;

            // Skip if already notified for this estimated end time
            if (visitor.extension_notified_at) {
                // Allow re-notify only if they extended (new end is >30min beyond last notif)
                const notifMs = new Date(visitor.extension_notified_at).getTime();
                const newEnd = entryMs + (visitor.estimated_hours * 3600000);
                if (newEnd - notifMs <= TEN_MIN_MS) continue; // Not extended yet
            }

            const cleanPhone = visitor.phone.replace(/\D/g, '').slice(-10);
            const chatId = `91${cleanPhone}@c.us`;
            const minutesLeft = Math.max(1, Math.round(timeLeft / 60000));
            const currentCharge = ((ageMs / 3600000) * (visitor.rate_per_hour || 5)).toFixed(2);

            const message =
                `⏰ *SmartParkk – Parking Reminder*\n\n` +
                `Hi ${visitor.name}! Your estimated parking time ends in *${minutesLeft} minutes*.\n\n` +
                `💰 Current charge: *₹${currentCharge}*\n\n` +
                `🔄 *Want to extend? Reply with:*\n` +
                `• *EXTEND 1* → +1 hour (₹${visitor.rate_per_hour || 5})\n` +
                `• *EXTEND 2* → +2 hours (₹${(visitor.rate_per_hour || 5) * 2})\n` +
                `• *EXTEND 3* → +3 hours (₹${(visitor.rate_per_hour || 5) * 3})\n\n` +
                `⚠️ *Important:* If you stay beyond your estimated time, a *₹50 fine* will be added to your charges!\n\n` +
                `If you are leaving soon, you can just ignore this message.\n\n` +
                `🚗 Plate: ${visitor.license_plate}`;

            try {
                await waClient.sendMessage(chatId, message);
                console.log(`[EXPIRY NOTIF] Sent to +91${cleanPhone} (${visitor.name}, ${minutesLeft}min left)`);

                await supabase
                    .from('visitors')
                    .update({ extension_notified_at: new Date().toISOString() })
                    .eq('id', visitor.id);
            } catch (sendErr) {
                console.error(`[EXPIRY NOTIF] Failed for ${cleanPhone}:`, sendErr.message);
            }
        }
    } catch (err) {
        console.error('[EXPIRY CHECK] Error:', err.message);
    }
}

// Run every 2 minutes
setInterval(checkParkingExpiryNotifications, 2 * 60 * 1000);
