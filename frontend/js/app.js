/* State */
let visitorData = {
    id: '',
    name: '',
    phone: '',
    licensePlate: '',
    visitingFlat: '',
    entryTime: null,
    exitTime: null,
    ratePerHour: parseFloat(localStorage.getItem('smartpark_rate_per_hour')) || 5,
    totalCharge: 0,
    estimatedHours: 4,
    selectedSpot: null   // e.g. { label: 'N03', type: 'normal' }
};

// =============================================
// GLOBAL SETTINGS SYNC (from Backend)
// =============================================
async function syncSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        settings.forEach(s => {
            if (s.key === 'smartpark_total_parking') {
                localStorage.setItem('smartpark_total_parking', s.value);
            }
            if (s.key === 'smartpark_rate_per_hour') {
                localStorage.setItem('smartpark_rate_per_hour', s.value);
                visitorData.ratePerHour = parseFloat(s.value);
                const rateEl = document.getElementById('active-rate-display');
                if (rateEl) rateEl.textContent = '₹' + visitorData.ratePerHour.toFixed(2) + ' / hour';
            }
            if (s.key === 'smartpark_fine_amount') {
                localStorage.setItem('smartpark_fine_amount', s.value);
            }
        });
    } catch (e) { console.warn('[SETTINGS] Sync failed:', e); }
}

// Sync once on load
syncSettings();

// =============================================
// LIVE SPOTS AVAILABLE BANNER
// =============================================
let lastSpotCount = null;

async function fetchAndUpdateSpots() {
    try {
        const res = await fetch('/api/visitors');
        const all = await res.json();
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        // Count currently parked (no exitTime, within 24h)
        const occupied = (all || []).filter(v => {
            if (v.exitTime) return false;
            return (now - new Date(v.entryTime).getTime()) <= ONE_DAY;
        }).length;

        // Sync settings first to get latest total
        await syncSettings();

        // Read total capacity (now updated from syncSettings; fallback to 50)
        const total = parseInt(localStorage.getItem('smartpark_total_parking') || '50');

        // Calculate available spots
        const available = Math.max(0, total - occupied);

        updateSpotsBanner(available, total);
    } catch (e) {
        // Server unreachable — keep showing last value or hide
        const banner = document.getElementById('spots-banner');
        if (banner && lastSpotCount === null) banner.style.opacity = '0.4';
    }
}

function updateSpotsBanner(available, total) {
    const inner = document.querySelector('.spots-banner-inner');
    const countEl = document.getElementById('spots-count');
    if (!inner || !countEl) return;

    // Pop animation when number changes
    if (lastSpotCount !== null && lastSpotCount !== available) {
        countEl.classList.remove('popping');
        void countEl.offsetWidth; // reflow
        countEl.classList.add('popping');
        setTimeout(() => countEl.classList.remove('popping'), 400);
    }
    lastSpotCount = available;
    countEl.textContent = `${available} / ${total}`;

    // Colour state
    inner.classList.remove('low', 'full');
    if (available === 0) {
        inner.classList.add('full');
    } else if (available <= Math.max(Math.floor(total * 0.15), 3)) {
        inner.classList.add('low'); // <= 15% left → amber
    }
    // else stays green
}

// Fetch immediately and every 15 seconds
fetchAndUpdateSpots();
setInterval(fetchAndUpdateSpots, 15000);

// =============================================
// DURATION PICKER
// =============================================
let selectedHours = 4; // default
function getRate() {
    return parseFloat(localStorage.getItem('smartpark_rate_per_hour')) || 5;
}

function updateEstimate(hours) {
    const el = document.getElementById('est-charge');
    if (!el) return;
    const rate = getRate();
    const charge = (parseFloat(hours) || 0) * rate;
    el.textContent = '\u20B9' + charge.toFixed(2);
}

// Wire up chips after DOM ready (called after DOMContentLoaded equivalent — safe here since app.js loads at bottom)
(function initDurationPicker() {
    const chips = document.querySelectorAll('.chip');
    const customWrap = document.getElementById('custom-duration-wrap');
    const customHoursInput = document.getElementById('custom-hours');
    const customMinsInput = document.getElementById('custom-mins');

    function updateCustomEstimate() {
        let h = parseInt(customHoursInput.value) || 0;
        let m = parseInt(customMinsInput.value) || 0;

        // Apply visual boundaries (0 bounds)
        h = Math.max(0, Math.min(h, 24));
        m = Math.max(0, Math.min(m, 59));

        // Ensure at least 10 min total parking if custom is selected
        if (h === 0 && m === 0) m = 10;

        // Convert the user's value into a decimal hour total
        const total = h + (m / 60);

        selectedHours = total;
        visitorData.estimatedHours = total;
        updateEstimate(total);
    }

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            const val = chip.dataset.hours;
            if (val === 'custom') {
                customWrap.style.display = 'flex';
                customHoursInput.focus();
                updateCustomEstimate();
            } else {
                customWrap.style.display = 'none';
                selectedHours = parseFloat(val);
                visitorData.estimatedHours = selectedHours;
                updateEstimate(selectedHours);
            }
        });
    });

    if (customHoursInput) {
        customHoursInput.addEventListener('input', updateCustomEstimate);
    }
    if (customMinsInput) {
        customMinsInput.addEventListener('input', updateCustomEstimate);
    }

    // Init estimate for default 4-hr chip
    updateEstimate(4);
})();

// Storage Helpers
async function saveToStorage(data) {
    try {
        await fetch('/api/visitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (err) { console.error('Error saving entry', err); }
}

async function updateStorage(data) {
    try {
        await fetch('/api/visitors/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (err) { console.error('Error updating entry', err); }
}

// =============================================
// OCR — IMPROVED ENGINE
// =============================================

let tesseractWorker = null;
let isScanning = false;

// Common OCR misread corrections for license plates
// e.g. letter O misread as 0, I misread as 1, etc.
const OCR_CORRECTIONS = [
    ['O', '0'], ['0', 'O'],
    ['I', '1'], ['1', 'I'],
    ['S', '5'], ['5', 'S'],
    ['B', '8'], ['8', 'B'],
    ['Z', '2'], ['2', 'Z'],
    ['G', '6'], ['6', 'G'],
    ['T', '7'], ['7', 'T'],
];

// Initialize Tesseract with plate-optimised settings
(async () => {
    try {
        tesseractWorker = await Tesseract.createWorker('eng');

        // PSM 7 = treat image as a single text line (ideal for plates)
        // OEM 1 = LSTM neural net engine (most accurate)
        await tesseractWorker.setParameters({
            tessedit_pageseg_mode: '7',
            tessedit_ocr_engine_mode: '1',
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            preserve_interword_spaces: '0',
        });

        console.log('✅ Tesseract OCR Initialized with plate-optimised settings.');
    } catch (e) {
        console.error('Tesseract Initialization Failed:', e);
    }
})();

// ── Image Preprocessing ───────────────────────────────────────────────────────
// Fast pipeline: crop → greyscale + contrast → Otsu threshold (single pass)
// Uses a persistent offscreen canvas to avoid per-frame GC allocation

let _offscreenCanvas = null;
let _offscreenCtx = null;

function preprocessPlateImage(sourceCanvas) {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;

    // Crop: centre 60% width × 40% height (where the plate lives)
    const cropX = Math.floor(w * 0.20);
    const cropY = Math.floor(h * 0.30);
    const cropW = Math.floor(w * 0.60);
    const cropH = Math.floor(h * 0.40);

    // Reuse offscreen canvas — no allocation on hot path
    if (!_offscreenCanvas || _offscreenCanvas.width !== cropW || _offscreenCanvas.height !== cropH) {
        _offscreenCanvas = document.createElement('canvas');
        _offscreenCanvas.width = cropW;
        _offscreenCanvas.height = cropH;
        _offscreenCtx = _offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Draw cropped region at native resolution (no upscale — keeps pixel count low)
    _offscreenCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const imgData = _offscreenCtx.getImageData(0, 0, cropW, cropH);
    const d = imgData.data;
    const numPixels = cropW * cropH;

    // ── Pass 1: greyscale + contrast stretch, build histogram ────────────────
    const grey = new Uint8Array(numPixels); // flat greyscale buffer
    const hist = new Int32Array(256);       // luminance histogram

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        // Luminance-weighted greyscale
        let g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;

        // Contrast stretch (clamp to 0-255)
        g = (((g / 255 - 0.5) * 1.8 + 0.5) * 255 + 0.5) | 0;
        if (g < 0) g = 0;
        if (g > 255) g = 255;

        grey[p] = g;
        hist[g]++;
    }

    // ── Pass 2: Otsu's threshold (O(256) — near-instant) ────────────────────
    // Finds the greyscale split that maximises between-class variance
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];

    let sumB = 0, wB = 0, maxVar = 0, threshold = 128;

    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = numPixels - wB;
        if (wF === 0) break;

        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);

        if (variance > maxVar) {
            maxVar = variance;
            threshold = t;
        }
    }

    // ── Pass 3: Apply threshold — dark text → black, background → white ──────
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const v = grey[p] < threshold ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
        // alpha stays 255
    }

    _offscreenCtx.putImageData(imgData, 0, 0);
    return _offscreenCanvas;
}

// ── OCR Confusion Correction ─────────────────────────────────────────────────
// Generates all realistic variants of a plate string by swapping
// commonly confused characters, then checks against the target
function normaliseOCRText(text) {
    return text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function levenshteinDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
}

function isFuzzyMatch(expected, detected) {
    if (!detected || !expected) return false;

    const exp = normaliseOCRText(expected);
    const det = normaliseOCRText(detected);

    // 1. Exact / substring match
    if (det.includes(exp) || exp.includes(det)) return true;

    // 2. Levenshtein distance — allow up to 2 character errors for plates ≥6 chars
    const maxErrors = exp.length >= 6 ? 2 : 1;
    const dist = levenshteinDistance(exp, det);
    if (dist <= maxErrors) {
        console.log(`✅ Levenshtein match: "${det}" ~ "${exp}" (distance ${dist})`);
        return true;
    }

    // 3. Sliding window — detected string may contain extra noise chars around the plate
    for (let start = 0; start <= det.length - exp.length; start++) {
        const window = det.substring(start, start + exp.length);
        const windowDist = levenshteinDistance(exp, window);
        if (windowDist <= maxErrors) {
            console.log(`✅ Window match: "${window}" ~ "${exp}" (distance ${windowDist})`);
            return true;
        }
    }

    // 4. OCR confusion swap — try swapping confused chars and re-check
    let swapped = det;
    for (const [from, to] of OCR_CORRECTIONS) {
        swapped = swapped.split(from).join(to);
    }
    if (swapped !== det) {
        const swappedDist = levenshteinDistance(exp, swapped);
        if (swappedDist <= maxErrors) {
            console.log(`✅ OCR-corrected match: "${swapped}" ~ "${exp}" (distance ${swappedDist})`);
            return true;
        }
        if (swapped.includes(exp)) return true;
    }

    console.log(`❌ No match: "${det}" vs "${exp}" (distance ${dist})`);
    return false;
}

// ── Multi-Frame Voting ────────────────────────────────────────────────────────
// Collects last N OCR reads and uses the most-seen result to avoid
// acting on a single noisy frame
const VOTE_WINDOW = 4; // require match in N consecutive/recent frames
let recentDetections = [];

function recordDetection(cleanText) {
    recentDetections.push(cleanText);
    if (recentDetections.length > VOTE_WINDOW * 2) recentDetections.shift();
}

function getVotedText() {
    if (recentDetections.length < 2) return null;
    const freq = {};
    for (const t of recentDetections) freq[t] = (freq[t] || 0) + 1;
    const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    return best[1] >= 2 ? best[0] : null; // needs ≥2 votes
}

// ── Main Scan Loop ────────────────────────────────────────────────────────────
async function continuousScan(videoId, callback, timeoutMs) {
    const video = document.getElementById(videoId);
    const canvas = document.getElementById('snapshot-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const prefix = videoId.split('-')[0];
    const statusMsg = document.getElementById(`${prefix}-status`);
    const container = document.querySelector(`#screen-${prefix}-scan .camera-container`) || document.getElementById('exit-camera-container');
    const overlay = document.getElementById(`detected-plate-${prefix}`);

    const targetPlateClean = visitorData.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    if (!tesseractWorker) {
        statusMsg.textContent = "OCR engine not ready. Please wait and retry.";
        return;
    }

    recentDetections = []; // reset vote buffer
    isScanning = true;
    container.classList.add('scanning');
    statusMsg.textContent = "📷 Point camera directly at the license plate...";

    const scanStartTime = Date.now();

    while (isScanning) {
        await new Promise(r => setTimeout(r, 600)); // slightly faster scan cadence
        if (!isScanning) break;

        if (timeoutMs && (Date.now() - scanStartTime) >= timeoutMs) {
            isScanning = false;
            stopCamera();
            container.classList.remove('scanning');
            alert('Scan timed out. Please try again.');
            showScreen('screen-register');
            return;
        }

        if (video.readyState !== video.HAVE_ENOUGH_DATA) continue;

        // Capture raw frame
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const remaining = timeoutMs
            ? Math.max(0, Math.ceil((timeoutMs - (Date.now() - scanStartTime)) / 1000))
            : null;

        try {
            // ① Preprocess: crop → greyscale → contrast → binarize
            const processedCanvas = preprocessPlateImage(canvas);

            // ② Run OCR on the clean image
            const result = await tesseractWorker.recognize(processedCanvas);
            const rawText = result.data.text;
            const cleanText = normaliseOCRText(rawText);

            if (cleanText.length > 2) {
                recordDetection(cleanText);
                const voted = getVotedText();
                const display = voted || cleanText;
                console.log(`👁 OCR: "${cleanText}" | Voted: "${voted}" | Target: "${targetPlateClean}"`);
                statusMsg.textContent = `${remaining ? `[${remaining}s] ` : ''}Scanning... Seen: ${display.substring(0, 12)}`;
            } else if (remaining) {
                statusMsg.textContent = `📷 Hold plate steady... ${remaining}s remaining`;
            }

            // ③ Match against target (use voted text if available, else raw)
            const textToMatch = getVotedText() || cleanText;
            if (cleanText.length > 2 && isFuzzyMatch(targetPlateClean, textToMatch)) {
                isScanning = false;
                overlay.style.display = 'block';
                overlay.textContent = visitorData.licensePlate;
                statusMsg.textContent = "✅ Plate Matched! Validating...";

                setTimeout(() => {
                    container.classList.remove('scanning');
                    overlay.style.color = '#10b981';
                    overlay.style.borderColor = '#10b981';
                    statusMsg.textContent = "🚗 Gate Opening...";

                    setTimeout(() => {
                        stopCamera();
                        callback();
                    }, 1500);
                }, 1000);
            }
        } catch (err) {
            console.warn("Frame OCR failed:", err);
        }
    }
}


let parkingTimer = null;
let currentStream = null;

async function startCamera(videoId) {
    try {
        // First try to force the rear camera
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { exact: 'environment' } }
            });
        } catch (e) {
            // Fallback to any available camera (e.g. laptop webcam)
            stream = await navigator.mediaDevices.getUserMedia({
                video: true
            });
        }
        const videoElement = document.getElementById(videoId);
        videoElement.srcObject = stream;
        currentStream = stream;
    } catch (err) {
        console.error("Camera access denied or unavailable", err);
        alert("Camera access is needed for plate detection.");
    }
}

function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
}

// DOM Elements
const screens = document.querySelectorAll('.screen');
const registerForm = document.getElementById('register-form');
const otpForm = document.getElementById('otp-form');
const displayPhone = document.getElementById('display-phone');
const otpInputs = document.querySelectorAll('.otp-input');

// Screen Navigation
function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
    }
}

function goBack(currentId, prevId) {
    showScreen(prevId);
}

// Inline error banner helper for the registration form
function showRegisterError(msg) {
    let banner = document.getElementById('register-block-error');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'register-block-error';
        banner.style.cssText = `
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 12px;
            color: #ef4444;
            font-size: 14px;
            font-weight: 500;
            padding: 12px 16px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: fadeIn 0.3s ease;
        `;
        // Insert before the submit button
        const submitBtn = registerForm.querySelector('button[type="submit"]');
        registerForm.insertBefore(banner, submitBtn);
    }
    banner.innerHTML = `<span style="font-size:18px;">🚫</span> ${msg}`;
    banner.style.display = 'flex';
}

function hideRegisterError() {
    const banner = document.getElementById('register-block-error');
    if (banner) banner.style.display = 'none';
}

// =============================================
// AUTO-SUBMIT: fire when all fields + spot ready
// =============================================
let _autoSubmitTimer = null;

function checkAutoSubmit() {
    const name = (document.getElementById('name')?.value || '').trim();
    const flat = (document.getElementById('visiting-flat')?.value || '').trim();
    const phone = (document.getElementById('phone')?.value || '').trim();
    const plate = (document.getElementById('license-plate')?.value || '').trim();
    const spot = visitorData.selectedSpot;

    const btn = registerForm?.querySelector('button[type="submit"]');
    if (!btn) return;

    const allFilled = name && flat && phone && plate && spot;

    if (allFilled) {
        // Show the "ready" state on the button
        btn.classList.add('btn-ready');
        btn.textContent = '✓ All set — Generating OTP…';
        btn.disabled = false; // ensure clickable

        // Auto-fire after a short pause so visitor can see the state
        clearTimeout(_autoSubmitTimer);
        _autoSubmitTimer = setTimeout(() => {
            if (visitorData.selectedSpot) {   // re-check spot still set
                registerForm.requestSubmit();
            }
        }, 600);
    } else {
        // Revert button to normal if something gets cleared
        clearTimeout(_autoSubmitTimer);
        btn.classList.remove('btn-ready');
        btn.textContent = 'Generate OTP';
        btn.disabled = false;
    }
}

// Wire auto-submit check to every form field
['name', 'visiting-flat', 'phone', 'license-plate'].forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) el.addEventListener('input', checkAutoSubmit);
});

// 1. Registration Submit
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideRegisterError();

    // ── SPOT REQUIRED CHECK ───────────────────────
    if (!visitorData.selectedSpot) {
        showRegisterError(
            'Please select a parking spot first — use the <strong>Normal</strong> or <strong>Access ♿</strong> buttons at the top.'
        );
        // Shake both top-bar buttons to point the visitor's attention there
        ['btn-normal-spots', 'btn-accessibility'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.remove('shake-attention');
            void btn.offsetWidth; // reflow to re-trigger
            btn.classList.add('shake-attention');
            btn.addEventListener('animationend', () => btn.classList.remove('shake-attention'), { once: true });
        });
        // Also highlight the lot-wrapper placeholder as an error
        const wrapper = document.getElementById('visitor-lot-wrapper');
        if (wrapper) {
            wrapper.classList.add('spot-required-error');
            setTimeout(() => wrapper.classList.remove('spot-required-error'), 2500);
        }
        return;
    }
    // ─────────────────────────────────────────────

    const rawPlate = document.getElementById('license-plate').value.toUpperCase();

    const btn = registerForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Checking access...';

    visitorData.name = document.getElementById('name').value;
    visitorData.phone = document.getElementById('phone').value;
    visitorData.licensePlate = rawPlate;
    visitorData.visitingFlat = document.getElementById('visiting-flat').value.toUpperCase();
    visitorData.estimatedHours = selectedHours;

    // ── BLOCK CHECK ──────────────────────────────
    try {
        const blockRes = await fetch(
            `/api/blocked-visitors/check?flatId=${encodeURIComponent(visitorData.visitingFlat)}&phone=${encodeURIComponent(visitorData.phone)}`
        );
        const blockData = await blockRes.json();

        if (blockData.blocked) {
            showRegisterError(
                `You have been blocked by the resident at <strong>${visitorData.visitingFlat}</strong>. ` +
                `Please contact the resident directly.`
            );
            btn.disabled = false;
            btn.textContent = 'Generate OTP';
            return; // Stop here — no OTP sent
        }
    } catch (err) {
        // If the check fails due to network, we log it but don't block the visitor
        console.warn('Block-check failed, proceeding:', err);
    }
    // ─────────────────────────────────────────────

    // ── ACTIVE CHECK ──────────────────────────────
    try {
        const dupRes = await fetch('/api/check-active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: visitorData.phone, licensePlate: visitorData.licensePlate })
        });
        const dupData = await dupRes.json();

        if (dupData.isActive) {
            showRegisterError(dupData.message);
            btn.disabled = false;
            btn.textContent = 'Generate OTP';
            return; // Stop here — no OTP sent
        }
    } catch (err) {
        console.warn('Duplicate-check failed, proceeding:', err);
    }
    // ─────────────────────────────────────────────

    // ── RESIDENT AVAILABILITY CHECK ──────────────
    try {
        const residentsRes = await fetch('/api/residents');
        const residents = await residentsRes.json();

        // Find resident(s) for the visiting flat
        const residentForFlat = residents.find(r =>
            r.baseFlatId && r.baseFlatId.toUpperCase() === visitorData.visitingFlat.toUpperCase()
        );

        if (residentForFlat && residentForFlat.isAvailable === false) {
            showRegisterError(
                `The resident at <strong>${visitorData.visitingFlat}</strong> is currently unavailable. ` +
                `Please try again later or contact them directly.`
            );
            btn.disabled = false;
            btn.textContent = 'Generate OTP';
            return; // Stop here — no OTP sent
        }
    } catch (err) {
        console.warn('Availability-check failed, proceeding:', err);
    }
    // ─────────────────────────────────────────────

    btn.textContent = 'Sending OTP...';

    try {
        const res = await fetch('/api/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: visitorData.phone })
        });
        const data = await res.json();

        if (data.success) {
            displayPhone.textContent = `+91 ${visitorData.phone}`;
            const mockNote = document.querySelector('.mock-note');
            if (data.demo) {
                mockNote.innerHTML = `⚠️ <b>WhatsApp not connected.</b><br>Using Demo OTP: <span style="font-size: 1.2em; color: var(--highlight);">${data.otp}</span>`;
            } else {
                mockNote.innerHTML = '✅ OTP sent to your WhatsApp!';
            }
            mockNote.style.display = 'block';
            showScreen('screen-otp');
            setTimeout(() => otpInputs[0].focus(), 100);
        } else {
            alert(data.message || 'Failed to send OTP');
        }
    } catch (err) {
        alert('Server not reachable. Make sure server.js is running.');
        console.error(err);
    }

    btn.disabled = false;
    btn.textContent = 'Generate OTP';
    btn.classList.remove('btn-ready');
});

// OTP Input Logic
otpInputs.forEach((input, index) => {
    input.addEventListener('keyup', (e) => {
        if (e.key >= 0 && e.key <= 9) {
            if (index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        } else if (e.key === 'Backspace') {
            if (index > 0) {
                otpInputs[index - 1].focus();
            }
        }
    });
});

// 2. OTP Submit -> Spot Allocation
// 3. Entry Camera Scan

// Start checking when OTP verified
let pendingRequestId = null;
let approvalPollInterval = null;

otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const otpEntered = Array.from(otpInputs).map(i => i.value).join('');
    const btn = otpForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const res = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: visitorData.phone, otp: otpEntered })
        });
        const data = await res.json();

        if (data.success) {
            // OTP verified — now create a visitor request for the resident
            try {
                const reqRes = await fetch('/api/visitor-requests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        visitorName: visitorData.name,
                        visitorPhone: visitorData.phone,
                        licensePlate: visitorData.licensePlate,
                        visitingFlat: visitorData.visitingFlat
                    })
                });
                const reqData = await reqRes.json();

                if (reqData.success) {
                    pendingRequestId = reqData.request.id;
                    document.getElementById('waiting-flat-display').textContent = visitorData.visitingFlat;
                    showScreen('screen-waiting');

                    // Start polling for approval
                    startApprovalPolling();
                } else {
                    console.error('[Visitor Request Error]', reqData);
                    alert('Failed to create visitor request:\n' + (reqData.message || 'Unknown error'));
                }
            } catch (err) {
                alert('Server error while creating request.');
                console.error(err);
            }
        } else {
            alert(data.message || 'Invalid OTP');
        }
    } catch (err) {
        alert('Server not reachable. Make sure server.js is running.');
        console.error(err);
    }

    btn.disabled = false;
    btn.textContent = 'Verify & Enter';
});

function startApprovalPolling() {
    const statusMsg = document.getElementById('waiting-status-msg');

    approvalPollInterval = setInterval(async () => {
        if (!pendingRequestId) return;

        try {
            const res = await fetch(`/api/visitor-requests/${pendingRequestId}`);
            const data = await res.json();

            if (data.status === 'approved') {
                clearInterval(approvalPollInterval);
                approvalPollInterval = null;
                statusMsg.textContent = 'Approved! Please proceed to the gate.';

                // Go straight to waiting for admin to open gate
                setTimeout(() => {
                    showScreen('screen-admin-wait');
                    // We also start polling for the admin to OPEN the gate
                    // Note: We don't trigger the notification here anymore,
                    // because the ADMIN CAMERA will trigger it when it scans the car.
                    pollAdminGateAction();
                }, 1500);
            } else if (data.status === 'rejected') {
                clearInterval(approvalPollInterval);
                approvalPollInterval = null;
                showScreen('screen-denied');
            }
            // else still 'pending', keep polling
        } catch (err) {
            console.error('Polling error', err);
        }
    }, 3000); // Poll every 3 seconds
}

function cancelWaiting() {
    if (approvalPollInterval) {
        clearInterval(approvalPollInterval);
        approvalPollInterval = null;
    }
    pendingRequestId = null;
    resetApp();
}

// ── ADMIN ACCESS REQUEST (After Plate Match) ──────────────────

async function requestAdminAccess() {
    showScreen('screen-admin-wait');

    try {
        const res = await fetch('/api/gate-notifications/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestId: pendingRequestId,
                licensePlate: visitorData.licensePlate,
                visitingFlat: visitorData.visitingFlat,
                visitorName: visitorData.name,
                visitorPhone: visitorData.phone,
                type: 'approved'
            })
        });
        const data = await res.json();

        if (data.success) {
            if (data.status === 'opened') {
                console.log('[GATE] Already opened by admin/auto, starting parking...');
                startParking();
            } else {
                pollAdminGateAction(data.notificationId);
            }
        } else {
            console.error('[Admin Trigger Error]', data);
            alert('Failed to alert security admin. Please try again or contact security.');
            showScreen('screen-entry-scan');
        }
    } catch (err) {
        console.error('Trigger error', err);
        alert('Network error while alerting admin.');
    }
}

function pollAdminGateAction(notifId) {
    // If notifId is not provided, we poll by the global pendingRequestId
    const idStr = notifId ? String(notifId) : null;
    const pollUrl = idStr
        ? `/api/gate-notifications/${idStr}/status`
        : `/api/gate-notifications/status-by-request/${pendingRequestId}`;

    const pollInterval = setInterval(async () => {
        try {
            const res = await fetch(pollUrl);
            if (!res.ok) return;
            const data = await res.json();

            if (data.status === 'opened') {
                console.log('[GATE] Admin opened gate, starting parking...');
                clearInterval(pollInterval);
                startParking();
            }
        } catch (err) {
            console.error('Action poll error', err);
        }
    }, 2000); // Poll admin action every 2s

    // Safeguard: Stop polling after 4 minutes to avoid battery drain if something is stuck
    setTimeout(() => {
        if (pollInterval) {
            clearInterval(pollInterval);
            console.warn('[GATE] Polling timed out after 4 minutes.');
        }
    }, 4 * 60 * 1000);
}

// 4. Active Parking

function startParking() {
    visitorData.entryTime = new Date();
    const spotSuffix = visitorData.selectedSpot ? `-${visitorData.selectedSpot.label}` : '';
    visitorData.id = Date.now().toString() + spotSuffix;
    visitorData.ratePerHour = getRate();

    // Save to local storage array for the admin dashboard
    saveToStorage(visitorData);

    // Update UI
    document.getElementById('active-plate').textContent = visitorData.licensePlate;
    document.getElementById('entry-time-display').textContent = visitorData.entryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Render selected-spot minimap (if visitor chose one)
    _updateActiveParkingSpot();

    showScreen('screen-active');

    // Start Timer
    updateTimer();
    parkingTimer = setInterval(updateTimer, 1000);
}

function updateTimer() {
    const now = Date.now();
    const entryMs = new Date(visitorData.entryTime).getTime();
    const diffMs = now - entryMs;

    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);

    const formattedTime =
        String(diffHrs).padStart(2, '0') + ':' +
        String(diffMins).padStart(2, '0') + ':' +
        String(diffSecs).padStart(2, '0');

    document.getElementById('time-elapsed').textContent = formattedTime;

    // Calculate charge
    const exactHours = diffMs / 3600000;
    visitorData.totalCharge = Math.max(exactHours * visitorData.ratePerHour, 0);

    document.getElementById('current-charge').textContent = '₹' + visitorData.totalCharge.toFixed(2);
}

// 5. Automatic Exit on plate detection
function handleAutoExit() {
    clearInterval(parkingTimer);
    stopCamera();

    visitorData.exitTime = new Date();
    updateFinalReceipt();
    showScreen('screen-receipt');
}

function updateFinalReceipt() {
    // Ensure dates are proper Date objects
    const entry = new Date(visitorData.entryTime);
    const exit = new Date(visitorData.exitTime);
    const diffMs = exit.getTime() - entry.getTime();

    console.log('Entry:', entry.toISOString(), 'Exit:', exit.toISOString(), 'Diff ms:', diffMs);

    const exactHours = diffMs / 3600000;
    const baseCharge = Math.max(exactHours * visitorData.ratePerHour, 0);

    // Calculate fine if exceeded estimated time
    const estimatedMs = (visitorData.estimatedHours || 4) * 3600000;
    const FINE_AMOUNT = parseInt(localStorage.getItem('smartpark_fine_amount')) || 50; // Get from admin settings
    const exceedsFine = diffMs > estimatedMs ? FINE_AMOUNT : 0;
    const finalCharge = baseCharge + exceedsFine;

    visitorData.totalCharge = finalCharge;

    // Update local storage with final metrics
    updateStorage(visitorData);

    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);

    document.getElementById('receipt-name').textContent = visitorData.name;
    document.getElementById('receipt-plate').textContent = visitorData.licensePlate;
    document.getElementById('receipt-entry').textContent = entry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('receipt-exit').textContent = exit.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('receipt-duration').textContent = `${diffHrs}h ${diffMins}m ${diffSecs}s`;

    // Display charges with fine breakdown if applicable
    let chargeDisplay = `₹${baseCharge.toFixed(2)}`;
    if (exceedsFine > 0) {
        chargeDisplay += ` + ₹${FINE_AMOUNT} (fine) = ₹${finalCharge.toFixed(2)}`;
    }
    document.getElementById('receipt-total').textContent = chargeDisplay;
}

function resetApp() {
    window.location.reload();
}

// =============================================
// PARKING SPOTS MODAL
// =============================================
// Track which spot the visitor has chosen (cleared on reset)
let _pendingSpot = null; // { label, type, emoji }

async function showParkingModal(type) {
    const overlay = document.getElementById('pm-overlay');
    const grid = document.getElementById('pm-grid');
    const title = document.getElementById('pm-title');
    const icon = document.getElementById('pm-icon');
    const stats = document.getElementById('pm-stats');

    // Clear any old selection banner
    _clearSpotSelectionBanner();

    // Fetch live visitor data
    let activeVisitors = [];
    try {
        const res = await fetch('/api/visitors');
        const all = await res.json();
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        activeVisitors = (all || []).filter(v => {
            if (v.exitTime) return false;
            return (now - new Date(v.entryTime).getTime()) <= ONE_DAY;
        });
    } catch (e) { /* offline — show empty */ }

    const total = parseInt(localStorage.getItem('smartpark_total_parking') || '50');

    // SYNC WITH ADMIN LOT: Distribute total spots across 3 rows (A, B, C)
    const rowA = Math.ceil(total / 3);
    const rowB = Math.ceil((total - rowA) / 2);
    const rowC = total - rowA - rowB;

    const rows = [
        { prefix: 'A', count: rowA, start: 1 },
        { prefix: 'B', count: rowB, start: rowA + 1 },
        { prefix: 'C', count: rowC, start: rowA + rowB + 1 },
    ];

    const nonSuffixedActive = activeVisitors.filter(v => !(v.id && v.id.includes('-')));
    let oldIndex = 0;

    const allSpots = [];
    rows.forEach(r => {
        for (let i = 0; i < r.count; i++) {
            const isWheelchair = (i === 0); // first spot of every row is wheelchair accessible
            const label = `${r.prefix}${String(i + 1).padStart(2, '0')}`;

            let visitor = activeVisitors.find(v => v.id && v.id.includes('-') && v.id.split('-')[1] === label);
            if (!visitor && oldIndex < nonSuffixedActive.length) {
                visitor = nonSuffixedActive[oldIndex++];
            }

            allSpots.push({ label, isWheelchair, visitor });
        }
    });

    const isNormalMode = (type === 'normal');
    const filteredSpots = allSpots.filter(s => isNormalMode ? !s.isWheelchair : s.isWheelchair);

    const categoryTotal = filteredSpots.length;
    const categoryOccupied = filteredSpots.filter(s => s.visitor).length;
    const categoryFree = categoryTotal - categoryOccupied;
    const emojiStr = isNormalMode ? '🚗' : '♿';

    if (isNormalMode) {
        overlay.className = 'pm-overlay open mode-normal';
        title.textContent = 'Normal Parking';
        icon.textContent = '🚗';
        stats.innerHTML = `<strong style="color:#10b981">${categoryFree}</strong> free · <strong style="color:#ef4444">${categoryOccupied}</strong> occupied · ${categoryTotal} total`;
    } else {
        overlay.className = 'pm-overlay open mode-disabled';
        title.textContent = 'Physically Challenged Parking';
        icon.textContent = '♿';
        stats.innerHTML = `<strong style="color:#38bdf8">${categoryFree}</strong> free · <strong style="color:#ef4444">${categoryOccupied}</strong> occupied · ${categoryTotal} reserved`;
    }

    grid.innerHTML = '';
    filteredSpots.forEach(s => {
        const spot = document.createElement('div');

        if (s.visitor) {
            spot.className = isNormalMode ? 'pm-spot taken-normal' : 'pm-spot disabled-taken';
            spot.innerHTML = `
                <div class="pm-spot-num">${s.label}</div>
                <div class="pm-spot-emoji">${emojiStr}</div>
                <div class="pm-spot-plate">${s.visitor.licensePlate}</div>`;
        } else {
            spot.className = isNormalMode ? 'pm-spot free selectable' : 'pm-spot disabled-free selectable';
            if (visitorData.selectedSpot && visitorData.selectedSpot.label === s.label) {
                spot.classList.add('selected');
            }
            spot.innerHTML = `
                <div class="pm-spot-num">${s.label}</div>
                <div class="pm-spot-emoji">${emojiStr}</div>
                <div class="pm-spot-pick-hint">Tap to pick</div>`;
            spot.addEventListener('click', () => _onSpotPicked(spot, s.label, type, emojiStr, grid));
        }
        grid.appendChild(spot);
    });

    // If there is already a selected spot, show its confirmation banner
    if (visitorData.selectedSpot) {
        _renderSpotSelectionBanner(visitorData.selectedSpot.label, visitorData.selectedSpot.emoji);
    }

    // Trap scroll
    document.body.style.overflow = 'hidden';
}


/**
 * Called when visitor taps a free spot in the modal.
 */
function _onSpotPicked(spotEl, label, type, emoji, grid) {
    // Deselect all in grid
    grid.querySelectorAll('.pm-spot.selected').forEach(el => el.classList.remove('selected'));
    spotEl.classList.add('selected');

    // Persist choice
    _pendingSpot = { label, type, emoji };
    visitorData.selectedSpot = { label, type, emoji };

    // Show/update confirmation banner inside the modal
    _renderSpotSelectionBanner(label, emoji);

    // Also update the vl-your-spot-label if active screen is visible
    _updateActiveParkingSpot();

    // Trigger auto-submit check — might fire OTP generation automatically
    checkAutoSubmit();
}

function _renderSpotSelectionBanner(label, emoji) {
    const modal = document.getElementById('pm-modal');
    let banner = document.getElementById('pm-spot-selection-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pm-spot-selection-banner';
        banner.className = 'pm-selection-banner';
        // Insert before the road bar at the bottom
        const road = modal.querySelector('.pm-road');
        modal.insertBefore(banner, road);
    }
    banner.innerHTML = `
        <span class="pm-sel-check">✓</span>
        <span class="pm-sel-text">Spot <strong>${emoji} ${label}</strong> selected</span>
        <button class="pm-sel-clear" title="Clear selection" onclick="_clearSpotSelection()">✕</button>
    `;
    banner.classList.add('visible');
}

function _clearSpotSelectionBanner() {
    const banner = document.getElementById('pm-spot-selection-banner');
    if (banner) banner.remove();
}

function _clearSpotSelection() {
    visitorData.selectedSpot = null;
    _pendingSpot = null;
    // Deselect all tiles
    document.querySelectorAll('.pm-spot.selected').forEach(el => el.classList.remove('selected'));
    _clearSpotSelectionBanner();
    _updateActiveParkingSpot();
    // Revert button state & cancel any pending auto-submit
    checkAutoSubmit();
}

/**
 * Reflects the chosen spot on the Active Parking screen minimap.
 */
function _updateActiveParkingSpot() {
    const label = document.getElementById('vl-your-spot-label');
    const wrapper = document.getElementById('visitor-lot-wrapper');
    if (!label) return;

    if (visitorData.selectedSpot) {
        const { label: spotId, emoji } = visitorData.selectedSpot;
        label.innerHTML = `${emoji} Your reserved spot: <strong>${spotId}</strong>`;
        label.style.display = 'block';
        // Render mini-map with selected spot highlighted
        _renderActiveLotMap(spotId, wrapper);
    } else {
        label.textContent = '';
        label.style.display = 'none';
        if (wrapper) wrapper.innerHTML = '';
    }
}

/**
 * Renders a compact minimap on the Active Parking screen showing the lot
 * with the visitor's chosen spot highlighted.
 */
function _renderActiveLotMap(chosenSpotId, wrapper) {
    if (!wrapper) return;
    const total = parseInt(localStorage.getItem('smartpark_total_parking') || '50');

    // Distribute total spots across 3 rows (A, B, C) to match admin mapping
    const rowA = Math.ceil(total / 3);
    const rowB = Math.ceil((total - rowA) / 2);
    const rowC = total - rowA - rowB;
    const rows = [
        { prefix: 'A', count: rowA },
        { prefix: 'B', count: rowB },
        { prefix: 'C', count: rowC },
    ];

    const allSpots = [];
    rows.forEach(r => {
        for (let i = 0; i < r.count; i++) {
            allSpots.push(`${r.prefix}${String(i + 1).padStart(2, '0')}`);
        }
    });

    // Keep road label + dash, replace the rest
    wrapper.innerHTML = `
        <div class="vl-road">
            <span class="vl-road-label">&#8594; ENTRANCE</span>
            <div class="vl-road-dash"></div>
            <span class="vl-road-label">EXIT &#8594;</span>
        </div>
        <div class="vl-legend">
            <span><span class="vl-legend-dot vl-dot-mine"></span> Your Spot</span>
            <span><span class="vl-legend-dot vl-dot-free"></span> Free</span>
        </div>
        <div class="vl-minigrid" id="vl-minigrid"></div>
    `;

    const grid = document.getElementById('vl-minigrid');
    allSpots.forEach(id => {
        const tile = document.createElement('div');
        tile.className = id === chosenSpotId ? 'vl-tile vl-tile-mine' : 'vl-tile vl-tile-free';
        tile.title = id;
        tile.textContent = id;
        grid.appendChild(tile);
    });
}

function closeParkingModal(e) {
    // Close only when clicking the backdrop (not the modal itself)
    if (e && e.target !== document.getElementById('pm-overlay')) return;
    const overlay = document.getElementById('pm-overlay');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}
