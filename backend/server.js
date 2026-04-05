require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const dns = require('dns');
const fs = require('fs');
const webpush = require('web-push');

// ============================================
// META WHATSAPP CLOUD API
// ============================================
// Requires env vars: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
// Set these in Railway → Variables
const WA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const waReady = !!(WA_TOKEN && WA_PHONE_ID);

if (waReady) {
    console.log('  ✓  WhatsApp Cloud API configured — OTPs will be sent via WhatsApp.');
} else {
    console.warn('  ⚠  WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp OTP disabled.');
}

async function sendWhatsAppMessage(phone, message) {
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const fullPhone = `91${cleanPhone}`;
    const url = `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`;

    await axios.post(url, {
        messaging_product: 'whatsapp',
        to: fullPhone,
        type: 'text',
        text: { body: message }
    }, {
        headers: {
            'Authorization': `Bearer ${WA_TOKEN}`,
            'Content-Type': 'application/json'
        },
        timeout: 15000
    });
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

// WhatsApp status endpoint
app.get('/api/whatsapp-status', (req, res) => {
    res.json({ ready: waReady });
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

// ============================================
// ADMIN AUTH API (SUPABASE)
// ============================================

// Register an admin
app.post('/api/admin/register', async (req, res) => {
    const { username, password, phone } = req.body;
    if (!username || !password || !phone) {
        return res.status(400).json({ success: false, message: 'Username, password, and phone are required' });
    }

    try {
        const { data, error } = await supabase
            .from('admins')
            .insert([{ username, password, phone }])
            .select();

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ success: false, message: 'Username already exists' });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
        res.json({ success: true, admin: { username: data[0].username } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    // Backward compatibility for hardcoded demo account
    if (username === 'admin' && password === 'Admin@123') {
        return res.json({ success: true, admin: { username: 'admin' } });
    }

    try {
        const { data, error } = await supabase
            .from('admins')
            .select('*')
            .eq('username', username)
            .eq('password', password) // In a real app, use hashed passwords!
            .single();

        if (error || !data) {
            return res.status(401).json({ success: false, message: 'Invalid username or password' });
        }

        res.json({ success: true, admin: { username: data.username, email: data.email } });
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
// WHATSAPP OTP (Meta Cloud API — no QR needed)
// ============================================
const otpStore = {};  // phone -> { otp, expiresAt }

function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// POST /api/send-otp
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;

    if (!phone || phone.length < 10) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    if (!waReady) {
        return res.status(503).json({
            success: false,
            message: 'WhatsApp is not configured. Please contact the gate admin.'
        });
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const otp = generateOTP();
    otpStore[cleanPhone] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };

    try {
        await sendWhatsAppMessage(cleanPhone,
            `🔐 *SmartParkk OTP*\n\nYour OTP is: *${otp}*\n\n💡 *Parking Charges:*\nIf you exceed your parking duration, a ₹50 fine will be applied.\n\n_Expires in 5 minutes. Do not share this._`
        );

        console.log(`[WhatsApp OTP] Sent ${otp} → 91${cleanPhone}`);
        return res.json({ success: true, message: 'OTP sent to your WhatsApp!' });

    } catch (err) {
        console.error('[WhatsApp OTP] Send failed:', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to send OTP via WhatsApp. Please try again.'
        });
    }
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

// Delete a resident account (requires password confirmation)
app.delete('/api/residents/delete', async (req, res) => {
    const { flatInput, password } = req.body;
    if (!flatInput || !password) {
        return res.status(400).json({ success: false, message: 'flatInput and password are required' });
    }

    try {
        // Verify password first
        const { data: resident, error: fetchErr } = await supabase
            .from('residents')
            .select('id, password')
            .eq('flat_input', flatInput)
            .single();

        if (fetchErr || !resident) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }

        if (resident.password !== password) {
            return res.status(401).json({ success: false, message: 'Incorrect password.' });
        }

        // Delete blocked_visitors entries for this resident
        await supabase.from('blocked_visitors').delete().eq('resident_flat_id', flatInput);

        // Delete the resident
        const { error: deleteErr } = await supabase
            .from('residents')
            .delete()
            .eq('flat_input', flatInput);

        if (deleteErr) return res.status(500).json({ success: false, message: deleteErr.message });

        console.log(`[ACCOUNT] Resident ${flatInput} deleted their account.`);
        res.json({ success: true, message: 'Account deleted successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
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

    // Check if another vehicle with this plate is already parked
    let dupQuery = supabase
        .from('visitors')
        .select('id')
        .eq('license_plate', b.licensePlate)
        .is('exit_time', null);

    if (b.id) dupQuery = dupQuery.neq('id', b.id);

    const { data: existingVisitor } = await dupQuery.limit(1);

    if (existingVisitor && existingVisitor.length > 0) {
        return res.status(400).json({
            success: false,
            message: `Vehicle with plate ${b.licensePlate} is already parked. Please scan again to exit.`
        });
    }

    const { data, error } = await supabase.from('visitors').upsert([{
        id: b.id || Date.now().toString(),
        name: b.name,
        phone: b.phone,
        license_plate: b.licensePlate,
        visiting_flat: b.visitingFlat,
        entry_time: b.entryTime || new Date().toISOString(),
        exit_time: b.exitTime || null,
        rate_per_hour: (b.ratePerHour != null) ? b.ratePerHour : 5,
        total_charge: b.totalCharge || 0,
        estimated_hours: b.estimatedHours || 4,
        extension_notified_at: null
    }], { onConflict: 'id' }).select();

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
        .update({ estimated_hours: newEstimatedHours, extension_notified_at: {} })
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
            title: 'New Visitor Request!',
            body: `${request.visitorName} is waiting for your approval.`,
            data: { url: '/resident.html' }
        });
        webpush.sendNotification(sub, payload).catch(err => console.error('[PUSH ERROR]', err));
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
app.listen(PORT, () => {
    console.log(`\n  SmartParkk Server running at:`);
    console.log(`  → Visitor:  http://localhost:${PORT}`);
    console.log(`  → Resident: http://localhost:${PORT}/resident`);
    console.log(`  → Admin:    http://localhost:${PORT}/admin`);
    console.log(`  ✓  Database: Supabase (Cloud)`);
    console.log(`  ${waReady ? '✓' : '⚠'}  WhatsApp Cloud API: ${waReady ? 'Active' : 'Not configured (set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)'}\n`);
});

// ============================================
// PARKING EXPIRY NOTIFICATION JOB
// ============================================
async function checkParkingExpiryNotifications() {
    if (!waReady) return;

    try {
        const { data: visitors, error } = await supabase
            .from('visitors')
            .select('*')
            .is('exit_time', null);

        if (error || !visitors || visitors.length === 0) return;

        const now = Date.now();
        const THIRTY_MIN_MS = 30 * 60 * 1000;
        const FIVE_MIN_MS = 5 * 60 * 1000;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        for (const visitor of visitors) {
            if (!visitor.entry_time || !visitor.phone) continue;

            const entryMs = new Date(visitor.entry_time).getTime();
            const ageMs = now - entryMs;
            if (ageMs > ONE_DAY_MS) continue; // Stale

            const estimatedHours = visitor.estimated_hours || 4;
            const estimatedEndMs = entryMs + estimatedHours * 3600000;
            const timeLeft = estimatedEndMs - now;

            // Define stages
            let stage = null;
            if (timeLeft <= 0) {
                stage = 'expired';
            } else if (timeLeft <= FIVE_MIN_MS) {
                stage = 'urgent';
            } else if (timeLeft <= THIRTY_MIN_MS) {
                stage = 'warning';
            }

            if (!stage) continue;

            // Check tracker for this specific stage and estimated_hours
            const lastNotif = visitor.extension_notified_at ? JSON.parse(visitor.extension_notified_at) : {};
            const stageKey = `${stage}_${estimatedHours}`;

            if (lastNotif[stageKey]) continue; // Already sent this stage for this duration

            const cleanPhone = visitor.phone.replace(/\D/g, '').slice(-10);
            const chatId = `91${cleanPhone}@c.us`;
            const minutesLeft = Math.max(0, Math.round(timeLeft / 60000));
            const currentCharge = ((ageMs / 3600000) * (visitor.rate_per_hour || 5)).toFixed(2);
            const rate = visitor.rate_per_hour || 5;

            let message = '';
            if (stage === 'warning' || stage === 'urgent') {
                const timeStr = stage === 'warning' ? `*${minutesLeft} minutes*` : `ONLY *${minutesLeft} minutes*`;
                message =
                    `⏰ *SmartParkk – Parking Reminder*\n\n` +
                    `Hi ${visitor.name}! Your estimated parking duration ends in ${timeStr}.\n\n` +
                    `💰 Current base charge: *₹${currentCharge}*\n\n` +
                    `🔄 *Want to avoid a fine? Reply with:*\n` +
                    `• *EXTEND 1* → +1 hour (₹${rate})\n` +
                    `• *EXTEND 2* → +2 hours (₹${rate * 2})\n\n` +
                    `⚠️ *Fine Warning:* If you don't extend or leave in time, a *₹50 fine* will be added automatically.\n\n` +
                    `🚗 Plate: ${visitor.license_plate}`;
            } else if (stage === 'expired') {
                message =
                    `🚨 *SmartParkk – Parking EXPIRED*\n\n` +
                    `Hi ${visitor.name}, your estimated duration of ${estimatedHours}h has completed.\n\n` +
                    `⚠️ *Fine Applied:* A ₹50 fine has been added to your session as per policy.\n\n` +
                    `✅ *You can still extend to remove the fine!* Reply with:\n` +
                    `• *EXTEND 1* → +1 hour and *CANCEL FINE*\n\n` +
                    `If you are at the gate, please proceed to exit.\n` +
                    `🚗 Plate: ${visitor.license_plate}`;
            }

            try {
                await sendWhatsAppMessage(cleanPhone, message);
                console.log(`[EXPIRY NOTIF] Stage: ${stage} sent to +91${cleanPhone} (${visitor.name})`);

                // Update tracker
                const updatedTracker = { ...lastNotif, [stageKey]: true, last_sent_at: new Date().toISOString() };
                await supabase
                    .from('visitors')
                    .update({ extension_notified_at: JSON.stringify(updatedTracker) })
                    .eq('id', visitor.id);
            } catch (sendErr) {
                console.error(`[EXPIRY NOTIF] Error for ${cleanPhone}:`, sendErr.response?.data || sendErr.message);
            }
        }
    } catch (err) {
        console.error('[EXPIRY CHECK] Global Error:', err.message);
    }
}

// Run every 2 minutes
setInterval(checkParkingExpiryNotifications, 2 * 60 * 1000);
