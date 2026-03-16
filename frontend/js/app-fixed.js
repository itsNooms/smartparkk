// =====================================================
// VISITOR PORTAL - app.js
// =====================================================

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
// DURATION PICKER - CRITICAL FIX
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

// Wire up chips after DOM ready
function initDurationPicker() {
    console.log('🔧 Initializing duration picker...');
    
    const chips = document.querySelectorAll('.chip');
    const customWrap = document.getElementById('custom-duration-wrap');
    const customHoursInput = document.getElementById('custom-hours');
    const customMinsInput = document.getElementById('custom-mins');

    if (!chips.length) {
        console.warn('⚠️ Duration chips not found, retrying...');
        setTimeout(initDurationPicker, 500);
        return;
    }

    console.log(`✅ Found ${chips.length} duration chips`);

    function updateCustomEstimate() {
        let h = parseInt(customHoursInput.value) || 0;
        let m = parseInt(customMinsInput.value) || 0;

        // Apply visual boundaries
        h = Math.max(0, Math.min(h, 24));
        m = Math.max(0, Math.min(m, 59));

        // Ensure at least 10 min total parking if custom is selected
        if (h === 0 && m === 0) m = 10;

        // Convert to decimal hours
        const total = h + (m / 60);

        selectedHours = total;
        visitorData.estimatedHours = total;
        console.log(`📊 Custom duration updated: ${h}h ${m}m = ${total.toFixed(2)} hours`);
        updateEstimate(total);
    }

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            const val = chip.dataset.hours;
            console.log(`👆 Chip clicked: ${val}`);
            
            if (val === 'custom') {
                customWrap.style.display = 'flex';
                customHoursInput.focus();
                updateCustomEstimate();
            } else {
                customWrap.style.display = 'none';
                selectedHours = parseFloat(val);
                visitorData.estimatedHours = selectedHours;
                console.log(`📊 Duration set: ${selectedHours} hours`);
                updateEstimate(selectedHours);
            }
            
            // Trigger auto-submit check
            checkAutoSubmit();
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
    console.log('✅ Duration picker initialized');
}

// Call on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDurationPicker);
} else {
    initDurationPicker();
}

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

// =====================================================
// OCR ENGINE (from previous version)
// =====================================================

// Camera state tracking
let cameraState = {
    isActive: false,
    isScanningFrame: false,
    lastFrameTime: 0,
    freezeTimeout: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const OCR_CONFIG = {
    FRAME_INTERVAL_MS: 400,
    VOTE_WINDOW: 8,
    MIN_CONFIDENCE: 0.75,
    SCAN_TIMEOUT_DEFAULT: 30000,
    PLATE_MIN_LENGTH: 10,
    PLATE_MAX_LENGTH: 12,
    PLATE_ASPECT_RATIO: { min: 3, max: 5.5 },
    MIN_PLATE_AREA_RATIO: 0.08,
    MAX_PLATE_AREA_RATIO: 0.95,
    MIN_CONTRAST: 30,
    MIN_FOCUS_SHARPNESS: 0.4,
    CONTRAST_ENHANCE: 1.8,
    BRIGHTNESS_ADJUST: 10,
    KERNEL_SHARPEN: true,
};

const OCR_CORRECTIONS = [
    { pattern: /0(?=[A-Z]{2})/g, replace: 'O' },
    { pattern: /(?<=[A-Z])1(?=[A-Z])/g, replace: 'I' },
    { pattern: /5(?=[A-Z]{2})/g, replace: 'S' },
    { pattern: /8(?=[A-Z]{2})/g, replace: 'B' },
    { pattern: /Z/g, replace: '2' },
    { pattern: /G/g, replace: '6' },
    { pattern: /T(?=\d)/g, replace: '7' },
    { pattern: /l(?=\d)/gi, replace: '1' },
    { pattern: /O(?=[0-9]{2,})/g, replace: '0' },
];

const PLATE_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{1,2}\d{4}$/;
const VALID_STATES = ['AP', 'AR', 'AS', 'BR', 'CT', 'GA', 'GJ', 'HR', 'HP', 'JK', 'JH', 'KA', 
                      'KL', 'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OR', 'PB', 'RJ', 'SK', 'TN', 
                      'TG', 'TR', 'UP', 'UT', 'WB', 'LD', 'CH', 'DL', 'PY'];

let tesseractWorker = null;
let isScanning = false;
let recentDetections = [];
let frameStats = { total: 0, successful: 0, skipped: 0, qualityIssues: [] };

// ── FRAME QUALITY ASSESSMENT ──────────────────────────────────────────────────
function assessFrameQuality(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    let minL = 255, maxL = 0;
    const luminance = [];
    for (let i = 0; i < data.length; i += 4) {
        const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        luminance.push(L);
        minL = Math.min(minL, L);
        maxL = Math.max(maxL, L);
    }
    const contrast = maxL - minL;
    
    const width = canvas.width;
    const height = canvas.height;
    let edgeSum = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const gx = luminance[idx - width - 1] + 2*luminance[idx - 1] + luminance[idx + width - 1]
                     - luminance[idx - width + 1] - 2*luminance[idx + 1] - luminance[idx + width + 1];
            const gy = luminance[idx - width - 1] + 2*luminance[idx - width] + luminance[idx - width + 1]
                     - luminance[idx + width - 1] - 2*luminance[idx + width] - luminance[idx + width + 1];
            edgeSum += Math.sqrt(gx*gx + gy*gy);
        }
    }
    const sharpness = edgeSum / (width * height) / 255;
    
    let darkPixels = 0;
    for (let L of luminance) {
        if (L < 100) darkPixels++;
    }
    const darkRatio = darkPixels / luminance.length;
    
    return {
        contrast: contrast,
        sharpness: sharpness,
        darkRatio: darkRatio,
        isGood: contrast >= OCR_CONFIG.MIN_CONTRAST && sharpness >= OCR_CONFIG.MIN_FOCUS_SHARPNESS
    };
}

// ── PREPROCESSING ────────────────────────────────────────────────────────────
function preprocessPlateImage(canvas) {
    const ctx = canvas.getContext('2d');
    let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imgData.data;
    
    const cropX = canvas.width * 0.15;
    const cropY = canvas.height * 0.2;
    const cropW = canvas.width * 0.7;
    const cropH = canvas.height * 0.6;
    
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    let cropData = cropCtx.getImageData(0, 0, cropW, cropH);
    let cropPixels = cropData.data;
    
    const grey = new Uint8ClampedArray(cropW * cropH);
    let histogram = new Uint32Array(256);
    
    for (let i = 0, j = 0; i < cropPixels.length; i += 4, j++) {
        const L = 0.299 * cropPixels[i] + 0.587 * cropPixels[i+1] + 0.114 * cropPixels[i+2];
        grey[j] = L;
        histogram[Math.floor(L)]++;
    }
    
    const cumulative = new Uint32Array(256);
    cumulative[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
        cumulative[i] = cumulative[i-1] + histogram[i];
    }
    
    const totalPixels = cropW * cropH;
    const equalized = new Uint8ClampedArray(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
        const normalized = (cumulative[grey[i]] / totalPixels) * 255;
        equalized[i] = Math.floor(normalized);
    }
    
    const enhanced = new Uint8ClampedArray(totalPixels);
    const mean = equalized.reduce((a,b) => a+b) / totalPixels;
    for (let i = 0; i < totalPixels; i++) {
        const val = (equalized[i] - mean) * OCR_CONFIG.CONTRAST_ENHANCE + mean + OCR_CONFIG.BRIGHTNESS_ADJUST;
        enhanced[i] = Math.max(0, Math.min(255, val));
    }
    
    const sharpened = new Uint8ClampedArray(totalPixels);
    if (OCR_CONFIG.KERNEL_SHARPEN) {
        for (let y = 1; y < cropH - 1; y++) {
            for (let x = 1; x < cropW - 1; x++) {
                const idx = y * cropW + x;
                const blur = (
                    enhanced[idx-cropW-1] + 2*enhanced[idx-cropW] + enhanced[idx-cropW+1] +
                    2*enhanced[idx-1] + 4*enhanced[idx] + 2*enhanced[idx+1] +
                    enhanced[idx+cropW-1] + 2*enhanced[idx+cropW] + enhanced[idx+cropW+1]
                ) / 16;
                
                const diff = enhanced[idx] - blur;
                const sharp = enhanced[idx] + diff * 0.6;
                sharpened[idx] = Math.max(0, Math.min(255, sharp));
            }
        }
        for (let i = 0; i < cropW; i++) {
            sharpened[i] = enhanced[i];
            sharpened[(cropH-1)*cropW + i] = enhanced[(cropH-1)*cropW + i];
        }
        for (let i = 0; i < cropH; i++) {
            sharpened[i*cropW] = enhanced[i*cropW];
            sharpened[i*cropW + cropW-1] = enhanced[i*cropW + cropW-1];
        }
    } else {
        for (let i = 0; i < totalPixels; i++) sharpened[i] = enhanced[i];
    }
    
    let threshold = computeOtsuThreshold(sharpened);
    const binary = new Uint8ClampedArray(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
        binary[i] = sharpened[i] > threshold ? 255 : 0;
    }
    
    const cleaned = morphologicalClean(binary, cropW, cropH);
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = cropW;
    finalCanvas.height = cropH;
    const finalCtx = finalCanvas.getContext('2d');
    const finalData = finalCtx.createImageData(cropW, cropH);
    const finalPixels = finalData.data;
    
    for (let i = 0, j = 0; i < finalPixels.length; i += 4, j++) {
        const val = cleaned[j];
        finalPixels[i] = finalPixels[i+1] = finalPixels[i+2] = val;
        finalPixels[i+3] = 255;
    }
    
    finalCtx.putImageData(finalData, 0, 0);
    return finalCanvas;
}

function computeOtsuThreshold(pixels) {
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i++) {
        histogram[pixels[i]]++;
    }
    
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    
    let weightBackground = 0;
    let sumBackground = 0;
    let maxVariance = 0;
    let optimalThreshold = 0;
    
    for (let t = 0; t < 256; t++) {
        weightBackground += histogram[t];
        if (weightBackground === 0) continue;
        
        const weightForeground = pixels.length - weightBackground;
        if (weightForeground === 0) break;
        
        sumBackground += t * histogram[t];
        const meanBackground = sumBackground / weightBackground;
        const meanForeground = (sum - sumBackground) / weightForeground;
        
        const variance = weightBackground * weightForeground * 
                        Math.pow(meanBackground - meanForeground, 2);
        
        if (variance > maxVariance) {
            maxVariance = variance;
            optimalThreshold = t;
        }
    }
    
    return optimalThreshold;
}

function morphologicalClean(pixels, width, height) {
    const result = new Uint8ClampedArray(pixels);
    
    const eroded = new Uint8ClampedArray(result);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            let allWhite = true;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (result[(y+dy)*width + (x+dx)] < 250) {
                        allWhite = false;
                        break;
                    }
                }
                if (!allWhite) break;
            }
            eroded[idx] = allWhite ? 255 : 0;
        }
    }
    
    const dilated = new Uint8ClampedArray(eroded);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            let anyWhite = false;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (eroded[(y+dy)*width + (x+dx)] > 200) {
                        anyWhite = true;
                        break;
                    }
                }
                if (anyWhite) break;
            }
            dilated[idx] = anyWhite ? 255 : 0;
        }
    }
    
    return dilated;
}

// ── NORMALIZATION & VALIDATION ────────────────────────────────────────────────
function normaliseOCRText(text) {
    if (!text) return '';
    let clean = text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    for (const correction of OCR_CORRECTIONS) {
        clean = clean.replace(correction.pattern, correction.replace);
    }
    return clean;
}

function isValidPlateFormat(text) {
    if (!text || text.length < OCR_CONFIG.PLATE_MIN_LENGTH) return false;
    if (text.length > OCR_CONFIG.PLATE_MAX_LENGTH) return false;
    if (PLATE_PATTERN.test(text)) {
        const stateCode = text.substring(0, 2);
        return VALID_STATES.includes(stateCode);
    }
    return false;
}

function computeConfidence(rawOcrResult, cleanText, frameQuality) {
    let score = 0.7;
    if (isValidPlateFormat(cleanText)) {
        score += 0.15;
    }
    if (rawOcrResult && rawOcrResult.data && rawOcrResult.data.confidence) {
        const tessConf = Math.min(rawOcrResult.data.confidence / 100, 1);
        score = Math.max(score, 0.6 + tessConf * 0.4);
    }
    if (frameQuality && frameQuality.sharpness > 0.6) {
        score += 0.1;
    }
    return Math.min(score, 1.0);
}

// ── VOTING SYSTEM ─────────────────────────────────────────────────────────────
function recordDetection(cleanText, confidence, quality) {
    recentDetections.push({
        text: cleanText,
        confidence: confidence,
        timestamp: Date.now(),
        quality: quality
    });
    if (recentDetections.length > OCR_CONFIG.VOTE_WINDOW * 3) {
        recentDetections.shift();
    }
}

function getVotedResult() {
    if (recentDetections.length < 2) return null;
    
    const votes = {};
    const confidences = {};
    
    for (const det of recentDetections) {
        if (!votes[det.text]) {
            votes[det.text] = [];
            confidences[det.text] = [];
        }
        votes[det.text].push(det);
        confidences[det.text].push(det.confidence);
    }
    
    let bestText = null;
    let bestCount = 0;
    let bestAvgConfidence = 0;
    
    for (const [text, instances] of Object.entries(votes)) {
        const count = instances.length;
        const avgConf = confidences[text].reduce((a, b) => a + b) / count;
        const isValid = isValidPlateFormat(text);
        
        if (count > bestCount || 
            (count === bestCount && isValid && !isValidPlateFormat(bestText)) ||
            (count === bestCount && isValid === isValidPlateFormat(bestText) && avgConf > bestAvgConfidence)) {
            bestText = text;
            bestCount = count;
            bestAvgConfidence = avgConf;
        }
    }
    
    if (!bestText) return null;
    
    const confidence = bestCount / recentDetections.length;
    
    return {
        text: bestText,
        confidence: confidence,
        votes: bestCount,
        totalFrames: recentDetections.length,
        avgOcrConfidence: bestAvgConfidence
    };
}

// ── FUZZY MATCHING ────────────────────────────────────────────────────────────
function levenshteinDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i-1] === b[j-1]) {
                dp[i][j] = dp[i-1][j-1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            }
        }
    }
    
    return dp[m][n];
}

function isFuzzyMatch(expected, detected) {
    if (!detected || !expected) return false;
    
    const exp = normaliseOCRText(expected);
    const det = normaliseOCRText(detected);
    
    if (det.includes(exp) || exp.includes(det)) {
        console.log(`✅ Exact match: "${det}" ~ "${exp}"`);
        return true;
    }
    
    const maxErrors = Math.ceil(exp.length / 5);
    const dist = levenshteinDistance(exp, det);
    
    if (dist <= maxErrors) {
        console.log(`✅ Levenshtein match: "${det}" ~ "${exp}" (distance ${dist}/${maxErrors})`);
        return true;
    }
    
    if (det.length >= exp.length) {
        for (let i = 0; i <= det.length - exp.length; i++) {
            const window = det.substring(i, i + exp.length);
            const windowDist = levenshteinDistance(exp, window);
            if (windowDist <= maxErrors) {
                console.log(`✅ Window match: "${window}" ~ "${exp}" (distance ${windowDist})`);
                return true;
            }
        }
    }
    
    let swapped = det;
    for (const { pattern, replace } of OCR_CORRECTIONS) {
        swapped = swapped.replace(pattern, replace);
    }
    if (swapped !== det && swapped === exp) {
        console.log(`✅ OCR-corrected match: "${swapped}" ~ "${exp}"`);
        return true;
    }
    
    console.log(`❌ No match: "${det}" vs "${exp}" (distance ${dist})`);
    return false;
}

// ── SCANNING LOOP ─────────────────────────────────────────────────────────────
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
        statusMsg.textContent = "⏳ OCR engine initializing...";
        setTimeout(() => continuousScan(videoId, callback, timeoutMs), 2000);
        return;
    }
    
    recentDetections = [];
    frameStats = { total: 0, successful: 0, skipped: 0, qualityIssues: [] };
    isScanning = true;
    cameraState.isActive = true;
    cameraState.reconnectAttempts = 0;
    
    container.classList.add('scanning');
    statusMsg.textContent = "📷 Position plate in frame...";
    
    const scanStartTime = Date.now();
    let lastSuccessfulRead = null;
    
    // Set freeze detection timeout
    const resetFreezeDetection = () => {
        clearTimeout(cameraState.freezeTimeout);
        cameraState.freezeTimeout = setTimeout(() => {
            console.warn('⚠️ Camera appears frozen, attempting recovery...');
            if (statusMsg) statusMsg.textContent = "📷 Recovering camera...";
            if (isScanning) {
                continuousScan(videoId, callback, timeoutMs);
            }
        }, 5000);
    };
    
    resetFreezeDetection();
    
    const cameraLoop = setInterval(async () => {
        if (!isScanning || !cameraState.isActive) {
            clearInterval(cameraLoop);
            clearTimeout(cameraState.freezeTimeout);
            return;
        }
        
        if (timeoutMs && (Date.now() - scanStartTime) >= timeoutMs) {
            isScanning = false;
            cameraState.isActive = false;
            clearInterval(cameraLoop);
            clearTimeout(cameraState.freezeTimeout);
            stopCamera();
            container.classList.remove('scanning');
            alert('Scan timed out. Please try again.');
            showScreen('screen-register');
            return;
        }
        
        if (video.readyState !== video.HAVE_ENOUGH_DATA) continue;
        
        resetFreezeDetection();
        frameStats.total++;
        cameraState.lastFrameTime = Date.now();
        
        const remaining = timeoutMs ? Math.max(0, Math.ceil((timeoutMs - (Date.now() - scanStartTime)) / 1000)) : null;
        
        try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const quality = assessFrameQuality(canvas);
            
            if (!quality.isGood) {
                frameStats.skipped++;
                statusMsg.textContent = `📷 ${quality.contrast < OCR_CONFIG.MIN_CONTRAST ? 'Improve lighting' : 'Hold steady'}... ${remaining ? `${remaining}s` : ''}`;
                return;
            }
            
            const processedCanvas = preprocessPlateImage(canvas);
            
            if (!cameraState.isScanningFrame) {
                cameraState.isScanningFrame = true;
                
                tesseractWorker.recognize(processedCanvas)
                    .then(ocrResult => {
                        try {
                            const rawText = ocrResult.data.text;
                            const cleanText = normaliseOCRText(rawText);
                            
                            if (cleanText.length < OCR_CONFIG.PLATE_MIN_LENGTH) {
                                frameStats.skipped++;
                                cameraState.isScanningFrame = false;
                                return;
                            }
                            
                            frameStats.successful++;
                            
                            const confidence = computeConfidence(ocrResult, cleanText, quality);
                            recordDetection(cleanText, confidence, quality);
                            
                            const voted = getVotedResult();
                            const displayText = voted ? voted.text : cleanText;
                            lastSuccessfulRead = voted || { text: cleanText, confidence: confidence };
                            
                            overlay.textContent = displayText;
                            overlay.style.display = 'block';
                            
                            const voteInfo = voted ? ` [${voted.votes}/${voted.totalFrames} frames]` : '';
                            const confPercent = ((voted?.confidence || confidence) * 100).toFixed(0);
                            
                            statusMsg.textContent = `${remaining ? `[${remaining}s] ` : ''}📸 ${displayText} (${confPercent}%)${voteInfo}`;
                            
                            console.log(`👁 OCR: "${cleanText}" | Voted: "${voted?.text}" | Confidence: ${confidence.toFixed(2)}`);
                            
                            const shouldMatch = voted ? isFuzzyMatch(targetPlateClean, voted.text) : false;
                            
                            if (shouldMatch && voted && voted.confidence >= OCR_CONFIG.MIN_CONFIDENCE) {
                                isScanning = false;
                                cameraState.isActive = false;
                                clearInterval(cameraLoop);
                                clearTimeout(cameraState.freezeTimeout);
                                
                                overlay.style.color = '#10b981';
                                overlay.style.borderColor = '#10b981';
                                statusMsg.textContent = "✅ Plate Matched! Validating...";
                                
                                setTimeout(() => {
                                    container.classList.remove('scanning');
                                    statusMsg.textContent = "🚗 Gate Opening...";
                                    
                                    setTimeout(() => {
                                        stopCamera();
                                        console.log(`📊 Scan Stats:`, frameStats);
                                        callback(lastSuccessfulRead);
                                    }, 1500);
                                }, 1000);
                            }
                        } catch (err) {
                            console.error('❌ OCR processing error:', err);
                        } finally {
                            cameraState.isScanningFrame = false;
                        }
                    })
                    .catch(err => {
                        console.warn('⚠️ OCR failed (will retry next frame):', err);
                        cameraState.isScanningFrame = false;
                        frameStats.skipped++;
                    });
            }
        } catch (err) {
            console.warn("❌ Frame capture failed:", err);
            frameStats.skipped++;
        }
    }, OCR_CONFIG.FRAME_INTERVAL_MS);
}

// ── TESSERACT INIT ────────────────────────────────────────────────────────────
(async () => {
    try {
        if (typeof Tesseract === 'undefined') {
            console.error('❌ Tesseract library not loaded');
            return;
        }
        
        tesseractWorker = await Tesseract.createWorker('eng');
        
        await tesseractWorker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
            tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            preserve_interword_spaces: '0',
        });
        
        console.log('✅ Tesseract OCR Initialized (Advanced)');
    } catch (err) {
        console.error('❌ Tesseract initialization failed:', err);
    }
})();

// ── CAMERA CONTROL ───────────────────────────────────────────────────────────
let currentStream = null;

async function startCamera(videoId) {
    try {
        console.log(`🎥 Starting camera for ${videoId}...`);
        
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { exact: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
        } catch (e) {
            console.warn('⚠️ Rear camera not available, trying any camera...');
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
        }
        
        const videoElement = document.getElementById(videoId);
        videoElement.srcObject = stream;
        currentStream = stream;
        cameraState.isActive = true;
        cameraState.reconnectAttempts = 0;
        
        console.log(`✅ Camera started: ${videoId}`);
        
        stream.getTracks().forEach(track => {
            track.onended = () => {
                console.warn('⚠️ Camera track ended');
                cameraState.isActive = false;
                if (isScanning) {
                    console.log('🔄 Attempting to restart camera...');
                    cameraState.reconnectAttempts++;
                    if (cameraState.reconnectAttempts < cameraState.maxReconnectAttempts) {
                        setTimeout(() => startCamera(videoId), 1000);
                    }
                }
            };
        });
        
    } catch (err) {
        console.error("❌ Camera access failed:", err);
        const statusMsg = document.getElementById(`${videoId.split('-')[0]}-status`);
        if (statusMsg) {
            statusMsg.textContent = "❌ Camera access denied. Please allow camera access.";
        }
        alert("Camera access required for plate detection.\n\nPlease:\n1. Go to Settings\n2. Find this app\n3. Enable Camera permission");
    }
}

function stopCamera() {
    cameraState.isActive = false;
    isScanning = false;
    clearTimeout(cameraState.freezeTimeout);
    
    if (currentStream) {
        currentStream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (e) {
                console.warn('⚠️ Error stopping camera track:', e);
            }
        });
        currentStream = null;
    }
    
    console.log('✅ Camera stopped cleanly');
}

function getScanStats() {
    const voted = getVotedResult();
    return {
        frameStats,
        recentDetections: recentDetections.map(d => ({
            text: d.text,
            confidence: d.confidence.toFixed(2),
            quality: {
                sharpness: d.quality.sharpness.toFixed(2),
                contrast: d.quality.contrast
            }
        })),
        voted: voted ? {
            text: voted.text,
            confidence: voted.confidence.toFixed(2),
            votes: `${voted.votes}/${voted.totalFrames}`,
            avgOcrConfidence: voted.avgOcrConfidence.toFixed(2)
        } : null
    };
}

// =============================================
// REST OF APP (Registration, Parking, etc)
// =============================================

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

// Inline error banner helper
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
// AUTO-SUBMIT
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
        btn.classList.add('btn-ready');
        btn.textContent = '✓ All set — Generating OTP…';
        btn.disabled = false;

        clearTimeout(_autoSubmitTimer);
        _autoSubmitTimer = setTimeout(() => {
            if (visitorData.selectedSpot) {
                registerForm.requestSubmit();
            }
        }, 600);
    } else {
        clearTimeout(_autoSubmitTimer);
        btn.classList.remove('btn-ready');
        btn.textContent = 'Generate OTP';
        btn.disabled = false;
    }
}

['name', 'visiting-flat', 'phone', 'license-plate'].forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) el.addEventListener('input', checkAutoSubmit);
});

// 1. Registration Submit
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideRegisterError();

    if (!visitorData.selectedSpot) {
        showRegisterError(
            'Please select a parking spot first — use the <strong>Normal</strong> or <strong>Access ♿</strong> buttons at the top.'
        );
        ['btn-normal-spots', 'btn-accessibility'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.remove('shake-attention');
            void btn.offsetWidth;
            btn.classList.add('shake-attention');
            btn.addEventListener('animationend', () => btn.classList.remove('shake-attention'), { once: true });
        });
        const wrapper = document.getElementById('visitor-lot-wrapper');
        if (wrapper) {
            wrapper.classList.add('spot-required-error');
            setTimeout(() => wrapper.classList.remove('spot-required-error'), 2500);
        }
        return;
    }

    const rawPlate = document.getElementById('license-plate').value.toUpperCase();

    const btn = registerForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Checking access...';

    visitorData.name = document.getElementById('name').value;
    visitorData.phone = document.getElementById('phone').value;
    visitorData.licensePlate = rawPlate;
    visitorData.visitingFlat = document.getElementById('visiting-flat').value.toUpperCase();
    visitorData.estimatedHours = selectedHours;

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
            return;
        }
    } catch (err) {
        console.warn('Block-check failed, proceeding:', err);
    }

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
            return;
        }
    } catch (err) {
        console.warn('Duplicate-check failed, proceeding:', err);
    }

    try {
        const residentsRes = await fetch('/api/residents');
        const residents = await residentsRes.json();

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
            return;
        }
    } catch (err) {
        console.warn('Availability-check failed, proceeding:', err);
    }

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

                setTimeout(() => {
                    showScreen('screen-admin-wait');
                    pollAdminGateAction();
                }, 1500);
            } else if (data.status === 'rejected') {
                clearInterval(approvalPollInterval);
                approvalPollInterval = null;
                showScreen('screen-denied');
            }
        } catch (err) {
            console.error('Polling error', err);
        }
    }, 3000);
}

function cancelWaiting() {
    if (approvalPollInterval) {
        clearInterval(approvalPollInterval);
        approvalPollInterval = null;
    }
    pendingRequestId = null;
    resetApp();
}

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
    }, 2000);

    setTimeout(() => {
        if (pollInterval) {
            clearInterval(pollInterval);
            console.warn('[GATE] Polling timed out after 4 minutes.');
        }
    }, 4 * 60 * 1000);
}

let parkingTimer = null;

function startParking() {
    visitorData.entryTime = new Date();
    const spotSuffix = visitorData.selectedSpot ? `-${visitorData.selectedSpot.label}` : '';
    visitorData.id = Date.now().toString() + spotSuffix;
    visitorData.ratePerHour = getRate();

    saveToStorage(visitorData);

    document.getElementById('active-plate').textContent = visitorData.licensePlate;
    document.getElementById('entry-time-display').textContent = visitorData.entryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    _updateActiveParkingSpot();

    showScreen('screen-active');

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

    const exactHours = diffMs / 3600000;
    visitorData.totalCharge = Math.max(exactHours * visitorData.ratePerHour, 0);

    document.getElementById('current-charge').textContent = '₹' + visitorData.totalCharge.toFixed(2);
}

function handleAutoExit() {
    clearInterval(parkingTimer);
    stopCamera();

    visitorData.exitTime = new Date();
    updateFinalReceipt();
    showScreen('screen-receipt');
}

function updateFinalReceipt() {
    const entry = new Date(visitorData.entryTime);
    const exit = new Date(visitorData.exitTime);
    const diffMs = exit.getTime() - entry.getTime();

    console.log('Entry:', entry.toISOString(), 'Exit:', exit.toISOString(), 'Diff ms:', diffMs);

    const exactHours = diffMs / 3600000;
    const baseCharge = Math.max(exactHours * visitorData.ratePerHour, 0);

    const estimatedMs = (visitorData.estimatedHours || 4) * 3600000;
    const FINE_AMOUNT = parseInt(localStorage.getItem('smartpark_fine_amount')) || 50;
    const exceedsFine = diffMs > estimatedMs ? FINE_AMOUNT : 0;
    const finalCharge = baseCharge + exceedsFine;

    visitorData.totalCharge = finalCharge;

    updateStorage(visitorData);

    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);

    document.getElementById('receipt-name').textContent = visitorData.name;
    document.getElementById('receipt-plate').textContent = visitorData.licensePlate;
    document.getElementById('receipt-entry').textContent = entry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('receipt-exit').textContent = exit.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('receipt-duration').textContent = `${diffHrs}h ${diffMins}m ${diffSecs}s`;

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
let _pendingSpot = null;

async function showParkingModal(type) {
    const overlay = document.getElementById('pm-overlay');
    const grid = document.getElementById('pm-grid');
    const title = document.getElementById('pm-title');
    const icon = document.getElementById('pm-icon');
    const stats = document.getElementById('pm-stats');

    _clearSpotSelectionBanner();

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
    } catch (e) { /* offline */ }

    const total = parseInt(localStorage.getItem('smartpark_total_parking') || '50');

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
            const isWheelchair = (i === 0);
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

    if (visitorData.selectedSpot) {
        _renderSpotSelectionBanner(visitorData.selectedSpot.label, visitorData.selectedSpot.emoji);
    }

    document.body.style.overflow = 'hidden';
}

function _onSpotPicked(spotEl, label, type, emoji, grid) {
    grid.querySelectorAll('.pm-spot.selected').forEach(el => el.classList.remove('selected'));
    spotEl.classList.add('selected');

    _pendingSpot = { label, type, emoji };
    visitorData.selectedSpot = { label, type, emoji };

    _renderSpotSelectionBanner(label, emoji);

    _updateActiveParkingSpot();

    checkAutoSubmit();
}

function _renderSpotSelectionBanner(label, emoji) {
    const modal = document.getElementById('pm-modal');
    let banner = document.getElementById('pm-spot-selection-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pm-spot-selection-banner';
        banner.className = 'pm-selection-banner';
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
    document.querySelectorAll('.pm-spot.selected').forEach(el => el.classList.remove('selected'));
    _clearSpotSelectionBanner();
    _updateActiveParkingSpot();
    checkAutoSubmit();
}

function _updateActiveParkingSpot() {
    const label = document.getElementById('vl-your-spot-label');
    const wrapper = document.getElementById('visitor-lot-wrapper');
    if (!label) return;

    if (visitorData.selectedSpot) {
        const { label: spotId, emoji } = visitorData.selectedSpot;
        label.innerHTML = `${emoji} Your reserved spot: <strong>${spotId}</strong>`;
        label.style.display = 'block';
        _renderActiveLotMap(spotId, wrapper);
    } else {
        label.textContent = '';
        label.style.display = 'none';
        if (wrapper) wrapper.innerHTML = '';
    }
}

function _renderActiveLotMap(chosenSpotId, wrapper) {
    if (!wrapper) return;
    const total = parseInt(localStorage.getItem('smartpark_total_parking') || '50');

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
    if (e && e.target !== document.getElementById('pm-overlay')) return;
    const overlay = document.getElementById('pm-overlay');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

console.log('✅ app.js loaded successfully');
