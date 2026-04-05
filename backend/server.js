require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const dns = require('dns');
const fs = require('fs');
const webpush = require('web-push');

// ============================================
// WHATSAPP WEB SETUP (QR CODE)
// ============================================
let waReady = false;
let latestQR = null;

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

waClient.on('qr', (qr) => {
    latestQR = qr;
    console.log('\n[WhatsApp] Scan this QR code with your phone:');
    qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
    waReady = true;
    latestQR = null;
    console.log('\n✓ WhatsApp Connected!');
});

// Start WhatsApp
waClient.initialize();

// ============================================
// APP SETUP
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ wa_ready: waReady });
});

// QR Code URL for scanning
app.get('/api/qr', async (req, res) => {
    if (waReady) return res.send('Connected!');
    if (!latestQR) return res.send('Starting WhatsApp... Refresh in 5s.');
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`<center><h1>Scan QR</h1><img src="${qrImage}"><script>setInterval(()=>fetch('/api/health').then(r=>r.json()).then(d=>d.wa_ready&&location.reload()),2000)</script></center>`);
});

// OTP Implementation
const otpStore = {};
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!waReady) return res.status(503).json({ success: false, message: 'WhatsApp not ready' });
    
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore[cleanPhone] = { otp, expiresAt: Date.now() + 300000 };

    try {
        await waClient.sendMessage(`91${cleanPhone}@c.us`, `🔑 Your SmartParkk OTP is: ${otp}`);
        res.json({ success: true, message: 'OTP Sent!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Send failed' });
    }
});

app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const stored = otpStore[cleanPhone];
    if (stored && stored.otp === otp && Date.now() < stored.expiresAt) {
        delete otpStore[cleanPhone];
        return res.json({ success: true });
    }
    res.json({ success: false, message: 'Invalid OTP' });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
