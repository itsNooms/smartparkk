// DOM Elements
const screens = document.querySelectorAll('.screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const forgotForm = document.getElementById('forgot-form');
const forgotOtpForm = document.getElementById('forgot-otp-form');
const resetForm = document.getElementById('reset-form');

// State
let currentResident = null;
let resettingFlatId = null;
let pendingResetPhone = null;

// Block modal state
let _blockModalAction = null; // 'block' | 'unblock'
let _blockModalData = null;   // { phone, name }

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    registerServiceWorker();
});

// PWA: Service Worker registration
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered with scope:', registration.scope);
        } catch (err) {
            console.error('Service Worker registration failed:', err);
        }
    }
}

// PWA: Web Push Subscription
async function subscribeUserToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Push messaging is not supported');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;

        // Fetch VAPID public key from backend
        const vapidResponse = await fetch('/api/vapid-key');
        const vapidData = await vapidResponse.json();
        const vapidPublicKey = vapidData.publicKey;
        
        if (!vapidPublicKey) {
            console.warn('VAPID public key not configured');
            return;
        }
        
        const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedVapidKey
        });

        console.log('User is subscribed:', subscription);

        // Send subscription to server
        if (currentResident) {
            await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    flatId: currentResident.flatInput,
                    subscription: subscription
                })
            });
        }
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.warn('User denied notification permission.');
        } else {
            console.error('Failed to subscribe the user: ', err);
        }
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Screen Navigation
function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
    }
}

// Check session on load
function checkSession() {
    const session = localStorage.getItem('smartpark_resident_session');
    if (session) {
        currentResident = JSON.parse(session);
        updateDashboard();
        showScreen('screen-home');
        // Auto-subscribe to push notifications if not already done
        setTimeout(subscribeUserToPush, 1000);
    } else {
        showScreen('screen-login');
    }
}

// Storage Helpers (Kept for session only, DB is now on backend)
// Session stays in local storage
function getSession() {
    return JSON.parse(localStorage.getItem('smartpark_resident_session') || 'null');
}

// Registration Logic
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('reg-name').value.trim();
    const flatInput = document.getElementById('reg-flat').value.trim().toUpperCase();
    const phone = document.getElementById('reg-phone').value.trim();
    const p1 = document.getElementById('reg-car-1').value.trim().toUpperCase();
    const p2 = document.getElementById('reg-car-2').value.trim().toUpperCase();
    const p3 = document.getElementById('reg-car-3').value.trim().toUpperCase();
    const carPlate = [p1, p2, p3].filter(Boolean).join(',') || 'N/A';
    const password = document.getElementById('reg-password').value.trim();

    if (!name || !flatInput || !phone || !password) {
        alert("Please fill in all details.");
        return;
    }

    const isTenant = flatInput.endsWith('T');
    const baseFlatId = isTenant ? flatInput.slice(0, -1) : flatInput;
    const role = isTenant ? 'Tenant' : 'Resident';

    try {
        const btn = registerForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Registering...';

        const res = await fetch('/api/residents');
        const residents = await res.json();

        const existing = residents.find(r => r.flatInput === flatInput);
        if (existing) {
            alert(`An account already exists for this ${role} ID.`);
            btn.disabled = false;
            btn.textContent = 'Register';
            return;
        }

        const newResident = { id: Date.now().toString(), name, flatInput, baseFlatId, role, phone, carPlate, password, isAvailable: true };

        await fetch('/api/residents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newResident)
        });

        alert("Registration successful! Please login.");
        showScreen('screen-login');
        registerForm.reset();

        btn.disabled = false;
        btn.textContent = 'Register';
    } catch (err) {
        alert("Could not connect to server.");
        console.error(err);
    }
});

// Login Logic
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const flatInput = document.getElementById('login-flat').value.trim().toUpperCase();
    const password = document.getElementById('login-password').value.trim();

    try {
        const btn = loginForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Logging in...';

        const res = await fetch('/api/residents');
        const residents = await res.json();

        const resident = residents.find(r => r.flatInput === flatInput && r.password === password);

        if (resident) {
            // Exclude password from session
            const sessionData = { id: resident.id, name: resident.name, flatInput: resident.flatInput, baseFlatId: resident.baseFlatId, role: resident.role, carPlate: resident.carPlate || 'N/A', isAvailable: resident.isAvailable !== false };
            localStorage.setItem('smartpark_resident_session', JSON.stringify(sessionData));
            currentResident = sessionData;

            loginForm.reset();
            updateDashboard();
            showScreen('screen-home');
        } else {
            alert("Invalid Flat ID/Tenant ID or Password.");
        }

        btn.disabled = false;
        btn.textContent = 'Login';
    } catch (err) {
        alert("Server not reachable.");
        console.error(err);
    }
});

// Forgot Password Logic
forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const flatInput = document.getElementById('forgot-flat').value.trim().toUpperCase();
    const phone = document.getElementById('forgot-phone').value.trim();

    try {
        const btn = forgotForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Sending OTP...';

        const resAll = await fetch('/api/residents');
        const residents = await resAll.json();

        const resident = residents.find(r => r.flatInput === flatInput && r.phone === phone);

        if (resident) {

            try {
                const res = await fetch('/api/send-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: phone })
                });
                const data = await res.json();

                if (data.success) {
                    resettingFlatId = resident.flatInput;
                    pendingResetPhone = phone;

                    const mockNote = document.getElementById('forgot-mock-note');
                    if (mockNote) {
                        if (data.demo) {
                            mockNote.innerHTML = `⚠️ <b>WhatsApp not connected.</b><br>Using Demo OTP: <span style="font-size: 1.2em; color: var(--primary);">${data.otp}</span>`;
                        } else {
                            mockNote.innerHTML = '✅ OTP sent to your WhatsApp!';
                        }
                        mockNote.style.display = 'block';
                    }

                    forgotForm.reset();
                    showScreen('screen-forgot-otp');

                    const firstInput = forgotOtpForm.querySelector('.otp-input');
                    if (firstInput) setTimeout(() => firstInput.focus(), 100);
                } else {
                    alert(data.message || 'Failed to send OTP');
                }
            } catch (err) {
                alert('Server not reachable. Make sure server.js is running.');
                console.error(err);
            }

            btn.disabled = false;
            btn.textContent = 'Verify Details';
        } else {
            alert("Account details do not match.");
            const btn = forgotForm.querySelector('button[type="submit"]');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Verify Details';
            }
        }
    } catch (err) {
        alert("Server not reachable.");
        console.error(err);
        const btn = forgotForm.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Verify Details';
        }
    }

});

// OTP Input Logic for Forgot Password
const forgotOtpInputs = document.querySelectorAll('#forgot-otp-inputs .otp-input');
if (forgotOtpInputs.length > 0) {
    forgotOtpInputs.forEach((input, index) => {
        input.addEventListener('keyup', (e) => {
            if (e.key >= '0' && e.key <= '9') {
                if (index < forgotOtpInputs.length - 1) {
                    forgotOtpInputs[index + 1].focus();
                }
            } else if (e.key === 'Backspace') {
                if (index > 0) {
                    forgotOtpInputs[index - 1].focus();
                }
            }
        });
    });
}

// Verify OTP Form Let's Go
forgotOtpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingResetPhone) return;

    const otpEntered = Array.from(forgotOtpInputs).map(i => i.value).join('');
    const btn = forgotOtpForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const res = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: pendingResetPhone, otp: otpEntered })
        });
        const data = await res.json();

        if (data.success) {
            forgotOtpForm.reset();
            showScreen('screen-reset');
        } else {
            alert(data.message || 'Invalid OTP');
        }
    } catch (err) {
        alert('Server not reachable.');
        console.error(err);
    }

    btn.disabled = false;
    btn.textContent = 'Verify OTP';
});

// Reset Password Logic
resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!resettingFlatId) return;

    const newPassword = document.getElementById('reset-password').value.trim();
    const confirmPassword = document.getElementById('reset-confirm-password').value.trim();
    const errorMsg = document.getElementById('resident-reset-error');

    if (newPassword !== confirmPassword) {
        if (errorMsg) {
            errorMsg.textContent = "Passwords do not match!";
            errorMsg.style.display = 'block';
        } else {
            alert('Passwords do not match!');
        }
        return;
    }

    if (newPassword.length < 6) {
        if (errorMsg) {
            errorMsg.textContent = "Password must be at least 6 characters.";
            errorMsg.style.display = 'block';
        } else {
            alert('Password must be at least 6 characters.');
        }
        return;
    }

    if (errorMsg) errorMsg.style.display = 'none';

    try {
        const btn = resetForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const updateRes = await fetch('/api/residents/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flatInput: resettingFlatId, password: newPassword })
        });

        const data = await updateRes.json();

        if (data.success) {
            alert("Password updated successfully! Please login with your new password.");
            resetForm.reset();
            resettingFlatId = null;
            pendingResetPhone = null;
            showScreen('screen-login');
        } else {
            alert("An error occurred. Please try again.");
        }

        btn.disabled = false;
        btn.textContent = 'Save New Password';
    } catch (err) {
        alert("Server not reachable.");
        console.error(err);
    }
});

// Availability Toggle Logic
const availabilityBtn = document.getElementById('availability-toggle');
if (availabilityBtn) {
    availabilityBtn.addEventListener('click', async () => {
        if (!currentResident) return;

        const newStatus = !currentResident.isAvailable;

        try {
            const res = await fetch('/api/residents/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ flatInput: currentResident.flatInput, isAvailable: newStatus })
            });
            const data = await res.json();

            if (data.success) {
                currentResident.isAvailable = newStatus;

                // Update Session
                localStorage.setItem('smartpark_resident_session', JSON.stringify(currentResident));

                // Update UI
                updateAvailabilityUI();
            } else {
                alert('Could not update availability.');
            }
        } catch (err) {
            alert('Server not reachable.');
            console.error(err);
        }
    });
}

function updateAvailabilityUI() {
    if (!currentResident) return;
    const btn = document.getElementById('availability-toggle');
    if (!btn) return;

    if (currentResident.isAvailable !== false) {
        btn.textContent = 'Available';
        btn.style.backgroundColor = 'var(--success)';
    } else {
        btn.textContent = 'Not Available';
        btn.style.backgroundColor = 'var(--danger)';
    }
}

// Logout Logic
function logoutResident() {
    localStorage.removeItem('smartpark_resident_session');
    currentResident = null;
    showScreen('screen-login');
}

// Dashboard Update
function updateDashboard() {
    if (!currentResident) return;

    document.getElementById('resident-name-display').textContent = currentResident.name;
    document.getElementById('resident-flat-display').textContent = currentResident.flatInput;

    updateAvailabilityUI();

    const roleTagDisplay = document.getElementById('resident-role-tag');
    if (roleTagDisplay) {
        roleTagDisplay.style.display = 'inline';
        roleTagDisplay.textContent = currentResident.role;
        roleTagDisplay.style.backgroundColor = currentResident.role === 'Tenant' ? 'var(--secondary)' : 'var(--primary)';
    }

    // Display vehicle
    const vehicleDisplay = document.getElementById('my-vehicle-display');
    if (vehicleDisplay) {
        const platesStr = currentResident.carPlate || 'N/A';
        if (platesStr && platesStr !== 'N/A') {
            const plates = platesStr.split(',').map(p => p.trim()).filter(Boolean);
            let html = '';
            plates.forEach((p, idx) => {
                html += `
                <div class="detail-row" style="margin-bottom: ${idx === plates.length - 1 ? '0' : '8px'}; display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-family: monospace; font-size: 16px; font-weight: 700; color: var(--highlight);">${p}</span>
                    <strong style="color: var(--success); font-size: 13px;">Registered</strong>
                </div>
                `;
            });
            vehicleDisplay.innerHTML = html;
        } else {
            vehicleDisplay.innerHTML = `<p style="color: var(--text-muted); font-size: 14px;">No vehicle registered.</p>`;
        }
    }

    // Load pending approvals from backend
    loadPendingApprovals();

    // Load blocked visitors
    loadBlockedVisitors();

    // Auto-refresh pending approvals every 3 seconds
    if (window._approvalInterval) clearInterval(window._approvalInterval);
    window._approvalInterval = setInterval(loadPendingApprovals, 3000);
}

async function loadPendingApprovals() {
    if (!currentResident) return;

    const container = document.getElementById('pending-approvals-list');
    if (!container) return;

    try {
        const baseFlatId = currentResident.baseFlatId || currentResident.flatInput;
        const res = await fetch(`/api/visitor-requests?flatId=${encodeURIComponent(baseFlatId)}`);
        const requests = await res.json();

        if (!requests || requests.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); font-size: 14px;">No visitors waiting for approval.</p>`;
            return;
        }

        container.innerHTML = '';
        requests.forEach(req => {
            const timeAgo = getTimeAgo(req.createdAt);
            const card = document.createElement('div');
            card.style.cssText = 'background: rgba(15,23,42,0.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; margin-bottom: 12px;';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div>
                        <div style="font-weight: 600; font-size: 15px; color: var(--text-main);">${req.visitorName}</div>
                        <div style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">📞 ${req.visitorPhone}</div>
                    </div>
                    <div style="text-align: right;">
                        <span style="background: rgba(56,189,248,0.15); color: var(--highlight); padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">${req.licensePlate}</span>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${timeAgo}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="respondToRequest('${req.id}', 'approved', this)" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: var(--success); color: white; font-weight: 600; font-size: 14px; cursor: pointer; font-family: 'Inter', sans-serif;">✓ Approve</button>
                    <button onclick="respondToRequest('${req.id}', 'rejected', this)" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: var(--danger); color: white; font-weight: 600; font-size: 14px; cursor: pointer; font-family: 'Inter', sans-serif;">✕ Reject</button>
                    <button onclick="openBlockModal('${req.visitorPhone}', '${req.visitorName.replace(/'/g, "&#39;")}')" class="block-btn-inline" title="Block this visitor">🚫 Block</button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        console.error('Failed to load pending approvals', err);
    }
}

async function respondToRequest(requestId, action, btnEl) {
    // Disable buttons immediately
    const parent = btnEl.parentElement;
    parent.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
    btnEl.textContent = action === 'approved' ? 'Approving...' : 'Rejecting...';

    try {
        const res = await fetch('/api/visitor-requests/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, action })
        });
        const data = await res.json();

        if (data.success) {
            // Immediately refresh the list
            loadPendingApprovals();
        } else {
            alert('Failed to respond to request.');
        }
    } catch (err) {
        alert('Server not reachable.');
        console.error(err);
    }
}

function getTimeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'Just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
}

// ============================================
// BLOCK / UNBLOCK FEATURE
// ============================================

function openBlockModal(phone, name) {
    _blockModalAction = 'block';
    _blockModalData = { phone, name };

    const overlay = document.getElementById('block-modal-overlay');
    const icon = document.getElementById('block-modal-icon');
    const title = document.getElementById('block-modal-title');
    const desc = document.getElementById('block-modal-desc');
    const confirmBtn = document.getElementById('block-modal-confirm');

    icon.textContent = '🚫';
    icon.style.background = 'rgba(239,68,68,0.15)';
    icon.style.color = '#ef4444';
    title.textContent = 'Block Visitor?';
    desc.textContent = `Block ${name} (${phone})? They will not be able to request entry to your flat again until you unblock them.`;
    confirmBtn.textContent = 'Block';
    confirmBtn.style.background = 'var(--danger)';

    overlay.style.display = 'flex';
    // Trigger animation re-run
    const inner = overlay.firstElementChild;
    inner.style.animation = 'none';
    requestAnimationFrame(() => { inner.style.animation = ''; });
}

function openUnblockModal(phone, name) {
    _blockModalAction = 'unblock';
    _blockModalData = { phone, name };

    const overlay = document.getElementById('block-modal-overlay');
    const icon = document.getElementById('block-modal-icon');
    const title = document.getElementById('block-modal-title');
    const desc = document.getElementById('block-modal-desc');
    const confirmBtn = document.getElementById('block-modal-confirm');

    icon.textContent = '✅';
    icon.style.background = 'rgba(16,185,129,0.15)';
    icon.style.color = '#10b981';
    title.textContent = 'Unblock Visitor?';
    desc.textContent = `Unblock ${name || phone}? They will be able to request entry to your flat again.`;
    confirmBtn.textContent = 'Unblock';
    confirmBtn.style.background = 'var(--success)';

    overlay.style.display = 'flex';
    const inner = overlay.firstElementChild;
    inner.style.animation = 'none';
    requestAnimationFrame(() => { inner.style.animation = ''; });
}

function closeBlockModal() {
    document.getElementById('block-modal-overlay').style.display = 'none';
    _blockModalAction = null;
    _blockModalData = null;
}

// Close modal when clicking outside
document.getElementById('block-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeBlockModal();
});

async function confirmBlockAction() {
    if (!_blockModalAction || !_blockModalData || !currentResident) return;

    const confirmBtn = document.getElementById('block-modal-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = _blockModalAction === 'block' ? 'Blocking...' : 'Unblocking...';

    try {
        if (_blockModalAction === 'block') {
            await blockVisitor(_blockModalData.phone, _blockModalData.name);
        } else {
            await unblockVisitor(_blockModalData.phone, _blockModalData.name);
        }
    } finally {
        confirmBtn.disabled = false;
        closeBlockModal();
    }
}

async function blockVisitor(phone, name) {
    if (!currentResident) return;
    try {
        const res = await fetch('/api/blocked-visitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                residentFlatId: currentResident.flatInput,
                visitorPhone: phone,
                visitorName: name || null
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`🚫 ${name || phone} has been blocked.`, 'danger');
            // Reject any pending request from this visitor automatically
            await rejectPendingByPhone(phone);
            loadBlockedVisitors();
            loadPendingApprovals();
        } else {
            alert('Could not block visitor: ' + (data.message || 'Unknown error'));
        }
    } catch (err) {
        alert('Server not reachable.');
        console.error(err);
    }
}

async function unblockVisitor(phone, name) {
    if (!currentResident) return;
    try {
        const res = await fetch('/api/blocked-visitors', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                residentFlatId: currentResident.flatInput,
                visitorPhone: phone
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ ${name || phone} has been unblocked.`, 'success');
            loadBlockedVisitors();
        } else {
            alert('Could not unblock: ' + (data.message || 'Unknown error'));
        }
    } catch (err) {
        alert('Server not reachable.');
        console.error(err);
    }
}

async function rejectPendingByPhone(phone) {
    // Auto-reject any pending request from the newly-blocked visitor
    try {
        const baseFlatId = currentResident.baseFlatId || currentResident.flatInput;
        const res = await fetch(`/api/visitor-requests?flatId=${encodeURIComponent(baseFlatId)}`);
        const requests = await res.json();
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const matches = (requests || []).filter(r => r.visitorPhone.replace(/\D/g, '').slice(-10) === cleanPhone);
        for (const req of matches) {
            await fetch('/api/visitor-requests/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: req.id, action: 'rejected' })
            });
        }
    } catch (err) {
        console.error('Could not auto-reject pending requests:', err);
    }
}

async function loadBlockedVisitors() {
    if (!currentResident) return;

    const container = document.getElementById('blocked-visitors-list');
    const badge = document.getElementById('blocked-count-badge');
    if (!container) return;

    try {
        const flatId = currentResident.flatInput;
        const res = await fetch(`/api/blocked-visitors?flatId=${encodeURIComponent(flatId)}`);
        const blocked = await res.json();

        if (!blocked || blocked.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); font-size: 14px;">No visitors blocked.</p>`;
            if (badge) badge.style.display = 'none';
            return;
        }

        // Badge
        if (badge) {
            badge.textContent = blocked.length;
            badge.style.display = 'inline-block';
        }

        container.innerHTML = '';
        blocked.forEach(b => {
            const row = document.createElement('div');
            row.className = 'block-visitor-row';
            const blockedDate = new Date(b.blockedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            row.innerHTML = `
                <div style="flex:1; overflow:hidden;">
                    <div style="font-weight:600; font-size:14px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${b.visitorName || 'Unknown'}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">📞 ${b.visitorPhone} · <span style="color:rgba(239,68,68,0.7);">Blocked ${blockedDate}</span></div>
                </div>
                <button class="unblock-btn" onclick="openUnblockModal('${b.visitorPhone}', '${(b.visitorName || '').replace(/'/g, "&#39;")}')">
                    Unblock
                </button>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        console.error('Failed to load blocked visitors:', err);
    }
}

// ============================================
// EDIT VEHICLES FEATURE
// ============================================

function openEditVehiclesModal() {
    if (!currentResident) return;

    const overlay = document.getElementById('edit-vehicles-modal-overlay');
    const input1 = document.getElementById('edit-car-1');
    const input2 = document.getElementById('edit-car-2');
    const input3 = document.getElementById('edit-car-3');

    // Reset fields
    input1.value = '';
    input2.value = '';
    input3.value = '';

    // Populate with existing plates
    const platesStr = currentResident.carPlate || 'N/A';
    if (platesStr !== 'N/A') {
        const plates = platesStr.split(',').map(p => p.trim()).filter(Boolean);
        if (plates[0]) input1.value = plates[0];
        if (plates[1]) input2.value = plates[1];
        if (plates[2]) input3.value = plates[2];
    }

    overlay.style.display = 'flex';
    const inner = overlay.firstElementChild;
    inner.style.animation = 'none';
    requestAnimationFrame(() => { inner.style.animation = ''; });
}

function closeEditVehiclesModal() {
    document.getElementById('edit-vehicles-modal-overlay').style.display = 'none';
}

document.getElementById('edit-vehicles-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditVehiclesModal();
});

async function saveVehicles() {
    if (!currentResident) return;

    const btn = document.getElementById('edit-vehicles-confirm');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const p1 = document.getElementById('edit-car-1').value.trim().toUpperCase();
        const p2 = document.getElementById('edit-car-2').value.trim().toUpperCase();
        const p3 = document.getElementById('edit-car-3').value.trim().toUpperCase();
        const newCarPlate = [p1, p2, p3].filter(Boolean).join(',') || 'N/A';

        const res = await fetch('/api/residents/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flatInput: currentResident.flatInput, carPlate: newCarPlate })
        });
        const data = await res.json();

        if (data.success) {
            currentResident.carPlate = newCarPlate;
            localStorage.setItem('smartpark_resident_session', JSON.stringify(currentResident));
            updateDashboard();
            closeEditVehiclesModal();
            showToast('✅ Vehicles updated successfully.', 'success');
        } else {
            alert('Could not update vehicles.');
        }
    } catch (err) {
        alert('Server not reachable.');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

// ============================================
// TOAST NOTIFICATION
// ============================================

function showToast(message, type = 'success') {
    const existing = document.getElementById('sp-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sp-toast';
    const bgColor = type === 'danger' ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
    toast.style.cssText = `
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${bgColor};
        color: white;
        padding: 12px 22px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
        z-index: 3000;
        box-shadow: 0 8px 30px rgba(0,0,0,0.35);
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1);
        white-space: nowrap;
        max-width: 90vw;
        text-align: center;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(12px)';
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}
