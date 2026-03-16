/**
 * Enhanced Camera Handler
 * Fixes camera freezing/stopping issues by:
 * - Running OCR in parallel without blocking camera feed
 * - Proper cleanup on tab switching
 * - Auto-recovery if camera freezes
 * - Better error handling
 */

// Camera state tracking
let cameraState = {
    isActive: false,
    isScanningFrame: false,
    lastFrameTime: 0,
    freezeTimeout: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3
};

/**
 * FIXED: Keep camera running smoothly while OCR runs in parallel
 * The problem: Awaiting OCR blocks the camera loop
 * The solution: Don't await - let OCR process in background
 */
async function continuousScanFixed(videoId, callback, timeoutMs) {
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
        setTimeout(() => continuousScanFixed(videoId, callback, timeoutMs), 2000);
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
    let frameCount = 0;
    
    // Set freeze detection timeout
    const resetFreezeDetection = () => {
        clearTimeout(cameraState.freezeTimeout);
        cameraState.freezeTimeout = setTimeout(() => {
            console.warn('⚠️ Camera appears frozen, attempting recovery...');
            if (statusMsg) statusMsg.textContent = "📷 Recovering camera...";
            // Restart the scan
            if (isScanning) {
                continuousScanFixed(videoId, callback, timeoutMs);
            }
        }, 5000); // If no frames for 5 seconds, restart
    };
    
    resetFreezeDetection();
    
    // Main camera loop - captures frames
    const cameraLoop = setInterval(async () => {
        if (!isScanning || !cameraState.isActive) {
            clearInterval(cameraLoop);
            clearTimeout(cameraState.freezeTimeout);
            return;
        }
        
        // Timeout check
        if (timeoutMs && (Date.now() - scanStartTime) >= timeoutMs) {
            isScanning = false;
            cameraState.isActive = false;
            clearInterval(cameraLoop);
            clearTimeout(cameraState.freezeTimeout);
            stopCamera();
            if (container) container.classList.remove('scanning');
            alert('Scan timed out. Please try again.');
            showScreen('screen-register');
            return;
        }
        
        // Check if video is ready
        if (video.readyState !== video.HAVE_ENOUGH_DATA) {
            return;
        }
        
        resetFreezeDetection();
        frameCount++;
        frameStats.total++;
        cameraState.lastFrameTime = Date.now();
        
        const remaining = timeoutMs ? Math.max(0, Math.ceil((timeoutMs - (Date.now() - scanStartTime)) / 1000)) : null;
        
        try {
            // CRITICAL FIX: Capture frame immediately (non-blocking)
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // ① QUALITY ASSESSMENT (fast, non-blocking)
            const quality = assessFrameQuality(canvas);
            
            if (!quality.isGood) {
                frameStats.skipped++;
                if (statusMsg) {
                    statusMsg.textContent = `📷 ${quality.contrast < OCR_CONFIG.MIN_CONTRAST ? 'Improve lighting' : 'Hold steady'}... ${remaining ? `${remaining}s` : ''}`;
                }
                return;
            }
            
            // ② PREPROCESS (fast, non-blocking)
            const processedCanvas = preprocessPlateImage(canvas);
            
            // ③ OCR IN PARALLEL (don't await - let it process in background)
            if (!cameraState.isScanningFrame) {
                cameraState.isScanningFrame = true;
                
                // Run OCR without blocking camera
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
                            
                            // ④ CONFIDENCE SCORING
                            const confidence = computeConfidence(ocrResult, cleanText, quality);
                            recordDetection(cleanText, confidence, quality);
                            
                            // ⑤ GET VOTED RESULT
                            const voted = getVotedResult();
                            const displayText = voted ? voted.text : cleanText;
                            lastSuccessfulRead = voted || { text: cleanText, confidence: confidence };
                            
                            // Update UI
                            if (overlay) {
                                overlay.textContent = displayText;
                                overlay.style.display = 'block';
                            }
                            
                            const voteInfo = voted ? ` [${voted.votes}/${voted.totalFrames} frames]` : '';
                            const confPercent = ((voted?.confidence || confidence) * 100).toFixed(0);
                            
                            if (statusMsg) {
                                statusMsg.textContent = `${remaining ? `[${remaining}s] ` : ''}📸 ${displayText} (${confPercent}%)${voteInfo}`;
                            }
                            
                            console.log(`👁 OCR: "${cleanText}" | Voted: "${voted?.text}" | Confidence: ${confidence.toFixed(2)}`);
                            
                            // ⑥ MATCH AGAINST TARGET
                            const shouldMatch = voted ? isFuzzyMatch(targetPlateClean, voted.text) : false;
                            
                            if (shouldMatch && voted && voted.confidence >= OCR_CONFIG.MIN_CONFIDENCE) {
                                isScanning = false;
                                cameraState.isActive = false;
                                clearInterval(cameraLoop);
                                clearTimeout(cameraState.freezeTimeout);
                                
                                if (overlay) {
                                    overlay.style.color = '#10b981';
                                    overlay.style.borderColor = '#10b981';
                                }
                                if (statusMsg) statusMsg.textContent = "✅ Plate Matched! Validating...";
                                
                                setTimeout(() => {
                                    if (container) container.classList.remove('scanning');
                                    if (statusMsg) statusMsg.textContent = "🚗 Gate Opening...";
                                    
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

/**
 * FIXED: Proper camera cleanup and restart
 */
function stopCameraFixed() {
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

/**
 * FIXED: Camera startup with better error recovery
 */
async function startCameraFixed(videoId) {
    try {
        console.log(`🎥 Starting camera for ${videoId}...`);
        
        let stream;
        try {
            // Try rear camera first (for mobile)
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { exact: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
        } catch (e) {
            console.warn('⚠️ Rear camera not available, trying any camera...');
            // Fallback to any available camera
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
        }
        
        const videoElement = document.getElementById(videoId);
        if (!videoElement) {
            console.error(`❌ Video element not found: ${videoId}`);
            return;
        }
        
        videoElement.srcObject = stream;
        currentStream = stream;
        cameraState.isActive = true;
        cameraState.reconnectAttempts = 0;
        
        console.log(`✅ Camera started: ${videoId}`);
        
        // Monitor camera health
        stream.getTracks().forEach(track => {
            track.onended = () => {
                console.warn('⚠️ Camera track ended');
                cameraState.isActive = false;
                if (isScanning) {
                    console.log('🔄 Attempting to restart camera...');
                    cameraState.reconnectAttempts++;
                    if (cameraState.reconnectAttempts < cameraState.maxReconnectAttempts) {
                        setTimeout(() => startCameraFixed(videoId), 1000);
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

/**
 * FIXED: Safe tab switching - stops old camera before starting new one
 */
function switchTabWithCameraCleanup(oldTabViews, newTabView, setupFunction) {
    // Stop any active camera/scanning
    stopCameraFixed();
    cameraState.isActive = false;
    isScanning = false;
    
    // Hide old views
    if (Array.isArray(oldTabViews)) {
        oldTabViews.forEach(v => { if (v) v.style.display = 'none'; });
    }
    
    // Show new view
    if (newTabView) {
        newTabView.style.display = 'block';
    }
    
    // Setup new view (call the view's setup function)
    if (setupFunction && typeof setupFunction === 'function') {
        // Give DOM time to render before starting camera
        setTimeout(setupFunction, 100);
    }
}

/**
 * EXPORT: Replace old functions with new ones
 * Add this to your app initialization:
 * 
 * window.continuousScan = continuousScanFixed;  // Replace the old one
 * window.startCamera = startCameraFixed;        // Replace the old one
 * window.stopCamera = stopCameraFixed;          // Replace the old one
 */

console.log('✅ Enhanced camera handler loaded');
