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

// =====================================================
// PROFESSIONAL OCR ENGINE - ADVANCED VERSION
// =====================================================
// Dramatically improved accuracy, validation, and scanning
// Features: intelligent preprocessing, confidence scoring, 
// multi-layer fuzzy matching, frame quality assessment

// ── CONFIG ────────────────────────────────────────────────────────────────────
const OCR_CONFIG = {
    // Scanning & timing
    FRAME_INTERVAL_MS: 400,              // faster frame capture for more samples
    VOTE_WINDOW: 8,                      // require agreement across 8+ frames for confidence
    MIN_CONFIDENCE: 0.75,                // 75% agreement threshold
    SCAN_TIMEOUT_DEFAULT: 30000,         // 30 seconds default
    
    // Plate geometry (typical Indian plates)
    PLATE_MIN_LENGTH: 10,                // minimum readable chars
    PLATE_MAX_LENGTH: 12,                // maximum readable chars
    PLATE_ASPECT_RATIO: { min: 3, max: 5.5 }, // width/height ratio
    
    // Quality thresholds
    MIN_PLATE_AREA_RATIO: 0.08,          // plate must be 8%+ of frame
    MAX_PLATE_AREA_RATIO: 0.95,          // plate can't be >95% of frame
    MIN_CONTRAST: 30,                    // minimum luminance spread
    MIN_FOCUS_SHARPNESS: 0.4,            // edge variance indicator
    
    // Preprocessing enhancement
    CONTRAST_ENHANCE: 1.8,               // multiply contrast boost
    BRIGHTNESS_ADJUST: 10,               // brighten dark plates
    KERNEL_SHARPEN: true,                // sharpen edges
};

// Common OCR character confusions + contextual fixes
const OCR_CORRECTIONS = [
    // Ambiguous chars (0/O, 1/I/L, 5/S, 8/B)
    { pattern: /0(?=[A-Z]{2})/g, replace: 'O' },  // 0 before 2+ letters → O
    { pattern: /(?<=[A-Z])1(?=[A-Z])/g, replace: 'I' }, // 1 between letters → I
    { pattern: /5(?=[A-Z]{2})/g, replace: 'S' },  // 5 before 2+ letters → S
    { pattern: /8(?=[A-Z]{2})/g, replace: 'B' },  // 8 before 2+ letters → B
    { pattern: /Z/g, replace: '2' },               // Z → 2 (numeric context)
    { pattern: /G/g, replace: '6' },               // G → 6 (numeric context)
    { pattern: /T(?=\d)/g, replace: '7' },         // T before digit → 7
    { pattern: /l(?=\d)/gi, replace: '1' },        // lowercase l before digit → 1
    { pattern: /O(?=[0-9]{2,})/g, replace: '0' }, // O before 2+ digits → 0
];

// Indian plate format validation (state code + registration)
const PLATE_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{1,2}\d{4}$/;
const VALID_STATES = ['AP', 'AR', 'AS', 'BR', 'CT', 'GA', 'GJ', 'HR', 'HP', 'JK', 'JH', 'KA', 
                      'KL', 'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OR', 'PB', 'RJ', 'SK', 'TN', 
                      'TG', 'TR', 'UP', 'UT', 'WB', 'LD', 'CH', 'DL', 'PY'];

// ── GLOBAL STATE ──────────────────────────────────────────────────────────────
let tesseractWorker = null;
let isScanning = false;
let recentDetections = [];  // buffer: { text, confidence, timestamp, quality }
let frameStats = {
    total: 0,
    successful: 0,
    skipped: 0,
    qualityIssues: []
};

// ── FRAME QUALITY ASSESSMENT ──────────────────────────────────────────────────
/**
 * Assess frame quality before OCR to skip waste processing time on bad frames
 */
function assessFrameQuality(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    // 1. Compute contrast (luminance spread)
    let minL = 255, maxL = 0;
    const luminance = [];
    for (let i = 0; i < data.length; i += 4) {
        const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        luminance.push(L);
        minL = Math.min(minL, L);
        maxL = Math.max(maxL, L);
    }
    const contrast = maxL - minL;
    
    // 2. Compute edge sharpness (Sobel-like gradient variance)
    const width = canvas.width;
    const height = canvas.height;
    let edgeSum = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            // Simple Sobel approximation
            const gx = luminance[idx - width - 1] + 2*luminance[idx - 1] + luminance[idx + width - 1]
                     - luminance[idx - width + 1] - 2*luminance[idx + 1] - luminance[idx + width + 1];
            const gy = luminance[idx - width - 1] + 2*luminance[idx - width] + luminance[idx - width + 1]
                     - luminance[idx + width - 1] - 2*luminance[idx + width] - luminance[idx + width + 1];
            edgeSum += Math.sqrt(gx*gx + gy*gy);
        }
    }
    const sharpness = edgeSum / (width * height) / 255; // normalized
    
    // 3. Plate area detection (black/white region density)
    let darkPixels = 0;
    for (let L of luminance) {
        if (L < 100) darkPixels++;
    }
    const darkRatio = darkPixels / luminance.length;
    
    const quality = {
        contrast: contrast,
        sharpness: sharpness,
        darkRatio: darkRatio,
        isGood: contrast >= OCR_CONFIG.MIN_CONTRAST && sharpness >= OCR_CONFIG.MIN_FOCUS_SHARPNESS
    };
    
    return quality;
}

// ── ADVANCED PREPROCESSING ────────────────────────────────────────────────────
/**
 * Multi-stage preprocessing for optimal OCR:
 * 1. Crop to center region (plate is usually centered)
 * 2. Greyscale + contrast enhancement
 * 3. Adaptive sharpening with edge detection
 * 4. Binarization with dynamic threshold
 * 5. Morphological cleanup (denoise)
 */
function preprocessPlateImage(canvas) {
    const ctx = canvas.getContext('2d');
    let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imgData.data;
    
    // ① CROP: Center 70% (plates usually centered)
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
    
    // ② GREYSCALE + HISTOGRAM EQUALIZATION for contrast boost
    const grey = new Uint8ClampedArray(cropW * cropH);
    let histogram = new Uint32Array(256);
    
    for (let i = 0, j = 0; i < cropPixels.length; i += 4, j++) {
        const L = 0.299 * cropPixels[i] + 0.587 * cropPixels[i+1] + 0.114 * cropPixels[i+2];
        grey[j] = L;
        histogram[Math.floor(L)]++;
    }
    
    // Compute cumulative histogram for equalization
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
    
    // ③ CONTRAST ENHANCEMENT
    const enhanced = new Uint8ClampedArray(totalPixels);
    const mean = equalized.reduce((a,b) => a+b) / totalPixels;
    for (let i = 0; i < totalPixels; i++) {
        const val = (equalized[i] - mean) * OCR_CONFIG.CONTRAST_ENHANCE + mean + OCR_CONFIG.BRIGHTNESS_ADJUST;
        enhanced[i] = Math.max(0, Math.min(255, val));
    }
    
    // ④ EDGE SHARPENING (unsharp mask)
    const sharpened = new Uint8ClampedArray(totalPixels);
    if (OCR_CONFIG.KERNEL_SHARPEN) {
        // Simple Gaussian blur for difference
        for (let y = 1; y < cropH - 1; y++) {
            for (let x = 1; x < cropW - 1; x++) {
                const idx = y * cropW + x;
                const blur = (
                    enhanced[idx-cropW-1] + 2*enhanced[idx-cropW] + enhanced[idx-cropW+1] +
                    2*enhanced[idx-1] + 4*enhanced[idx] + 2*enhanced[idx+1] +
                    enhanced[idx+cropW-1] + 2*enhanced[idx+cropW] + enhanced[idx+cropW+1]
                ) / 16;
                
                const diff = enhanced[idx] - blur;
                const sharp = enhanced[idx] + diff * 0.6; // unsharp strength
                sharpened[idx] = Math.max(0, Math.min(255, sharp));
            }
        }
        // Border handling
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
    
    // ⑤ ADAPTIVE BINARIZATION (Otsu's method for optimal threshold)
    let threshold = computeOtsuThreshold(sharpened);
    const binary = new Uint8ClampedArray(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
        binary[i] = sharpened[i] > threshold ? 255 : 0;
    }
    
    // ⑥ MORPHOLOGICAL CLEANUP (remove noise)
    const cleaned = morphologicalClean(binary, cropW, cropH);
    
    // ⑦ CONVERT BACK TO RGBA CANVAS
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

/**
 * Compute optimal binarization threshold using Otsu's method
 */
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

/**
 * Morphological operations: erosion + dilation to remove noise
 */
function morphologicalClean(pixels, width, height) {
    const result = new Uint8ClampedArray(pixels);
    
    // Simple erosion (3x3 kernel): all neighbors must be 255
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
    
    // Dilation: any neighbor is 255
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

// ── OCR TEXT NORMALIZATION & VALIDATION ───────────────────────────────────────
/**
 * Normalize OCR output with contextual intelligence
 */
function normaliseOCRText(text) {
    if (!text) return '';
    
    // Remove non-alphanumeric, uppercase
    let clean = text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    
    // Apply contextual corrections
    for (const correction of OCR_CORRECTIONS) {
        clean = clean.replace(correction.pattern, correction.replace);
    }
    
    return clean;
}

/**
 * Validate if text matches Indian plate format
 */
function isValidPlateFormat(text) {
    if (!text || text.length < OCR_CONFIG.PLATE_MIN_LENGTH) return false;
    if (text.length > OCR_CONFIG.PLATE_MAX_LENGTH) return false;
    
    // Try to match pattern
    if (PLATE_PATTERN.test(text)) {
        const stateCode = text.substring(0, 2);
        return VALID_STATES.includes(stateCode);
    }
    
    return false;
}

/**
 * Calculate confidence score for OCR result
 */
function computeConfidence(rawOcrResult, cleanText, frameQuality) {
    let score = 0.7; // base
    
    // Boost for format validity
    if (isValidPlateFormat(cleanText)) {
        score += 0.15;
    }
    
    // Boost for tesseract confidence if available
    if (rawOcrResult && rawOcrResult.data && rawOcrResult.data.confidence) {
        const tessConf = Math.min(rawOcrResult.data.confidence / 100, 1);
        score = Math.max(score, 0.6 + tessConf * 0.4);
    }
    
    // Adjust based on frame quality
    if (frameQuality && frameQuality.sharpness > 0.6) {
        score += 0.1;
    }
    
    return Math.min(score, 1.0);
}

// ── INTELLIGENT VOTING SYSTEM ─────────────────────────────────────────────────
/**
 * Record detection with quality metrics
 */
function recordDetection(cleanText, confidence, quality) {
    recentDetections.push({
        text: cleanText,
        confidence: confidence,
        timestamp: Date.now(),
        quality: quality
    });
    
    // Keep buffer bounded
    if (recentDetections.length > OCR_CONFIG.VOTE_WINDOW * 3) {
        recentDetections.shift();
    }
}

/**
 * Get voted result with confidence scoring
 * Returns { text, confidence, votes } or null
 */
function getVotedResult() {
    if (recentDetections.length < 2) return null;
    
    // Count votes by text
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
    
    // Find winner
    let bestText = null;
    let bestCount = 0;
    let bestAvgConfidence = 0;
    
    for (const [text, instances] of Object.entries(votes)) {
        const count = instances.length;
        const avgConf = confidences[text].reduce((a, b) => a + b) / count;
        
        // Prioritize: valid format > vote count > confidence
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
    
    // Check confidence threshold
    const confidence = bestCount / recentDetections.length;
    
    return {
        text: bestText,
        confidence: confidence,
        votes: bestCount,
        totalFrames: recentDetections.length,
        avgOcrConfidence: bestAvgConfidence
    };
}

// ── FUZZY MATCHING (Multi-layer) ──────────────────────────────────────────────
/**
 * Levenshtein distance (edit distance)
 */
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

/**
 * Multi-layer fuzzy match: exact → Levenshtein → sliding window → OCR swap
 */
function isFuzzyMatch(expected, detected) {
    if (!detected || !expected) return false;
    
    const exp = normaliseOCRText(expected);
    const det = normaliseOCRText(detected);
    
    // 1. Exact or substring match
    if (det.includes(exp) || exp.includes(det)) {
        console.log(`✅ Exact match: "${det}" ~ "${exp}"`);
        return true;
    }
    
    // 2. Levenshtein distance with plate-length-aware tolerance
    const maxErrors = Math.ceil(exp.length / 5); // allow ~1 error per 5 chars
    const dist = levenshteinDistance(exp, det);
    
    if (dist <= maxErrors) {
        console.log(`✅ Levenshtein match: "${det}" ~ "${exp}" (distance ${dist}/${maxErrors})`);
        return true;
    }
    
    // 3. Sliding window match (detected might have extra chars)
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
    
    // 4. Character swap recovery (OCR confusions)
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

// ── MAIN SCANNING LOOP ────────────────────────────────────────────────────────
/**
 * Advanced continuous scan with quality checks, confidence scoring, and voting
 */
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
    container.classList.add('scanning');
    statusMsg.textContent = "📷 Position plate in frame...";
    
    const scanStartTime = Date.now();
    let lastSuccessfulRead = null;
    
    while (isScanning) {
        await new Promise(r => setTimeout(r, OCR_CONFIG.FRAME_INTERVAL_MS));
        if (!isScanning) break;
        
        // Timeout check
        if (timeoutMs && (Date.now() - scanStartTime) >= timeoutMs) {
            isScanning = false;
            stopCamera();
            container.classList.remove('scanning');
            alert('Scan timed out. Please try again.');
            showScreen('screen-register');
            return;
        }
        
        if (video.readyState !== video.HAVE_ENOUGH_DATA) continue;
        
        frameStats.total++;
        const remaining = timeoutMs ? Math.max(0, Math.ceil((timeoutMs - (Date.now() - scanStartTime)) / 1000)) : null;
        
        try {
            // Capture frame
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // ① QUALITY ASSESSMENT
            const quality = assessFrameQuality(canvas);
            
            if (!quality.isGood) {
                frameStats.skipped++;
                frameStats.qualityIssues.push({
                    contrast: quality.contrast,
                    sharpness: quality.sharpness
                });
                statusMsg.textContent = `📷 ${quality.contrast < OCR_CONFIG.MIN_CONTRAST ? 'Improve lighting' : 'Hold steady'}... ${remaining ? `${remaining}s` : ''}`;
                continue;
            }
            
            // ② PREPROCESS
            const processedCanvas = preprocessPlateImage(canvas);
            
            // ③ RUN OCR
            const ocrResult = await tesseractWorker.recognize(processedCanvas);
            const rawText = ocrResult.data.text;
            const cleanText = normaliseOCRText(rawText);
            
            if (cleanText.length < OCR_CONFIG.PLATE_MIN_LENGTH) {
                frameStats.skipped++;
                statusMsg.textContent = `📷 Plate too small... ${remaining ? `${remaining}s` : ''}`;
                continue;
            }
            
            frameStats.successful++;
            
            // ④ CONFIDENCE SCORING
            const confidence = computeConfidence(ocrResult, cleanText, quality);
            recordDetection(cleanText, confidence, quality);
            
            // ⑤ GET VOTED RESULT
            const voted = getVotedResult();
            const displayText = voted ? voted.text : cleanText;
            lastSuccessfulRead = voted || { text: cleanText, confidence: confidence };
            
            // Update UI
            overlay.textContent = displayText;
            overlay.style.display = 'block';
            
            const voteInfo = voted ? ` [${voted.votes}/${voted.totalFrames} frames]` : '';
            const confPercent = ((voted?.confidence || confidence) * 100).toFixed(0);
            
            statusMsg.textContent = `${remaining ? `[${remaining}s] ` : ''}📸 ${displayText} (${confPercent}%)${voteInfo}`;
            
            console.log(`👁 OCR: "${cleanText}" | Voted: "${voted?.text}" | Confidence: ${confidence.toFixed(2)}`);
            
            // ⑥ MATCH AGAINST TARGET
            const shouldMatch = voted ? isFuzzyMatch(targetPlateClean, voted.text) : false;
            
            if (shouldMatch && voted && voted.confidence >= OCR_CONFIG.MIN_CONFIDENCE) {
                isScanning = false;
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
            console.warn("⚠️  Frame OCR failed:", err);
            frameStats.skipped++;
        }
    }
}

// ── INITIALIZATION ────────────────────────────────────────────────────────────
/**
 * Initialize Tesseract worker with optimal settings for license plates
 */
(async () => {
    try {
        if (typeof Tesseract === 'undefined') {
            console.error('❌ Tesseract library not loaded');
            return;
        }
        
        tesseractWorker = await Tesseract.createWorker('eng');
        
        // PSM 7 = treat as single text line (optimal for plates)
        // OEM 1 = LSTM neural net (most accurate)
        await tesseractWorker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
            tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            preserve_interword_spaces: '0',
        });
        
        console.log('✅ Tesseract OCR Initialized (Advanced)');
        console.log(`   └─ PSM: Single Line | OEM: LSTM | Whitelist: A-Z 0-9`);
    } catch (err) {
        console.error('❌ Tesseract initialization failed:', err);
    }
})();

// ── CAMERA CONTROL ───────────────────────────────────────────────────────────
let currentStream = null;

async function startCamera(videoId) {
    try {
        let stream;
        try {
            // Prefer rear/environment camera (for mobile)
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { exact: 'environment' } }
            });
        } catch (e) {
            // Fallback to any camera
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        
        const videoElement = document.getElementById(videoId);
        videoElement.srcObject = stream;
        currentStream = stream;
    } catch (err) {
        console.error("❌ Camera access denied:", err);
        alert("Camera access required for plate detection");
    }
}

function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
}

// ── DEBUG UTILITIES ───────────────────────────────────────────────────────────
/**
 * Export scan statistics to console
 */
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

let parkingTimer = null;

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
