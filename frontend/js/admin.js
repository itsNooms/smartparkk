document.addEventListener('DOMContentLoaded', () => {
    const SESSION_LIMIT = 10 * 60 * 1000; // 10 minutes

    // Dashboard state - declared at top to avoid temporal dead zone
    let dashboardInitialized = false;
    let refreshInterval = null;

    // ============================================
    // SCREEN MANAGEMENT
    // ============================================
    function showAuthScreen(screenId) {
        document.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    function showDashboard() {
        document.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('admin-dashboard').classList.add('active');
        initDashboard();
    }

    function showLogin() {
        document.getElementById('admin-dashboard').classList.remove('active');
        showAuthScreen('screen-login');
    }

    function updateActivity() {
        if (sessionStorage.getItem('smartpark_admin_auth') === 'true') {
            sessionStorage.setItem('smartpark_admin_time', Date.now().toString());
        }
    }

    // Add activity listeners
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(type => {
        document.addEventListener(type, updateActivity, { passive: true });
    });

    // ============================================
    // AUTH CHECK — show login or dashboard
    // ============================================
    const lastActivity = sessionStorage.getItem('smartpark_admin_time');
    if (sessionStorage.getItem('smartpark_admin_auth') === 'true' && lastActivity) {
        const inactiveTime = Date.now() - parseInt(lastActivity);
        if (inactiveTime < SESSION_LIMIT) {
            showDashboard();
            // Refresh timer on load
            updateActivity();
        } else {
            sessionStorage.removeItem('smartpark_admin_auth');
            sessionStorage.removeItem('smartpark_admin_time');
            showLogin();
        }
    } else {
        sessionStorage.removeItem('smartpark_admin_auth');
        sessionStorage.removeItem('smartpark_admin_time');
        showLogin();
    }

    // Auto-lock: check every 30 seconds while dashboard is open
    setInterval(() => {
        const t = sessionStorage.getItem('smartpark_admin_time');
        if (!t || (Date.now() - parseInt(t)) >= SESSION_LIMIT) {
            if (document.getElementById('admin-dashboard').classList.contains('active')) {
                sessionStorage.removeItem('smartpark_admin_auth');
                sessionStorage.removeItem('smartpark_admin_time');
                alert('Session expired due to inactivity. Please log in again.');
                showLogin();
            }
        }
    }, 30000);

    // ============================================
    // LOGIN FORM
    // ============================================
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const user = document.getElementById('username').value.trim();
        const pass = document.getElementById('password').value;

        // Hardcoded demo credentials
        if (user === 'admin' && pass === 'Admin@123') {
            sessionStorage.setItem('smartpark_admin_auth', 'true');
            sessionStorage.setItem('smartpark_admin_time', Date.now().toString());
            showDashboard();
        } else {
            loginError.style.display = 'block';

            // Shake animation for error
            const card = loginForm.closest('.login-card');
            card.style.transform = 'translate(-5px, 0)';
            setTimeout(() => card.style.transform = 'translate(5px, 0)', 50);
            setTimeout(() => card.style.transform = 'translate(-5px, 0)', 100);
            setTimeout(() => card.style.transform = 'translate(5px, 0)', 150);
            setTimeout(() => card.style.transform = 'translate(0, 0)', 200);
        }
    });

    // Navigation links
    document.getElementById('goto-forgot-link').addEventListener('click', (e) => {
        e.preventDefault();
        showAuthScreen('screen-forgot');
    });

    document.getElementById('forgot-back-login').addEventListener('click', () => {
        showAuthScreen('screen-login');
    });

    document.getElementById('otp-back-forgot').addEventListener('click', () => {
        showAuthScreen('screen-forgot');
    });

    document.getElementById('reset-back-login').addEventListener('click', () => {
        showAuthScreen('screen-login');
    });

    // ============================================
    // FORGOT PASSWORD FLOW
    // ============================================
    const forgotForm = document.getElementById('forgot-form');
    const otpForm = document.getElementById('forgot-otp-form');
    const resetForm = document.getElementById('reset-form');
    const resetError = document.getElementById('reset-error');
    const otpInputs = document.querySelectorAll('#admin-otp-inputs .otp-input');
    const mockNote = document.getElementById('admin-mock-note');
    let pendingResetAuth = null;

    // Step 1: Request OTP
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const adminId = document.getElementById('admin-email').value.trim();
        const btn = forgotForm.querySelector('button[type="submit"]');

        if (!adminId) return;

        let phoneToSend = adminId;
        if (adminId.toLowerCase() === 'admin' || adminId.includes('@')) {
            phoneToSend = '9999999999';
        }

        btn.disabled = true;
        btn.textContent = 'Sending...';

        try {
            const res = await fetch('/api/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneToSend })
            });
            const data = await res.json();

            if (data.success) {
                pendingResetAuth = phoneToSend;

                if (mockNote) {
                    if (data.demo) {
                        mockNote.innerHTML = `⚠️ <b>WhatsApp not connected.</b><br>Using Demo OTP: <span style="font-size: 1.2em; color: var(--highlight);">${data.otp}</span>`;
                    } else {
                        mockNote.innerHTML = '✅ OTP sent to your WhatsApp!';
                    }
                    mockNote.style.display = 'block';
                }

                showAuthScreen('screen-forgot-otp');
                setTimeout(() => otpInputs[0].focus(), 100);
            } else {
                alert(data.message || 'Failed to send OTP');
            }
        } catch (err) {
            alert('Server not reachable. Make sure backend is running.');
            console.error(err);
        }

        btn.disabled = false;
        btn.textContent = 'Send Reset OTP';
    });

    // OTP Input auto-advance
    otpInputs.forEach((input, index) => {
        input.addEventListener('keyup', (e) => {
            if (e.key >= '0' && e.key <= '9') {
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

    // Step 2: Verify OTP
    otpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pendingResetAuth) return;

        const otpEntered = Array.from(otpInputs).map(i => i.value).join('');
        const btn = otpForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Verifying...';

        try {
            const res = await fetch('/api/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: pendingResetAuth, otp: otpEntered })
            });
            const data = await res.json();

            if (data.success) {
                showAuthScreen('screen-reset');
            } else {
                alert(data.message || 'Invalid OTP');
            }
        } catch (err) {
            alert('Server Error');
        }

        btn.disabled = false;
        btn.textContent = 'Verify & Reset';
    });

    // Step 3: Save New Password
    resetForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const newPass = document.getElementById('new-password').value;
        const confirmPass = document.getElementById('confirm-password').value;

        if (newPass !== confirmPass) {
            resetError.textContent = "Passwords do not match!";
            resetError.style.display = 'block';
            return;
        }

        if (newPass.length < 6) {
            resetError.textContent = "Password must be at least 6 characters.";
            resetError.style.display = 'block';
            return;
        }

        resetError.style.display = 'none';
        alert("Password reset successfully!");
        showAuthScreen('screen-login');
    });

    // ============================================
    // DASHBOARD LOGIC
    // ============================================

    function initDashboard() {
        if (dashboardInitialized) return;
        dashboardInitialized = true;

        // Load saved settings from backend (sync across devices)
        fetch('/api/settings')
            .then(res => res.json())
            .then(settings => {
                settings.forEach(s => {
                    if (s.key === 'smartpark_total_parking') {
                        document.getElementById('total-parking-display').textContent = s.value;
                        document.getElementById('total-parking-input').value = s.value;
                        localStorage.setItem('smartpark_total_parking', s.value);
                    }
                    if (s.key === 'smartpark_rate_per_hour') {
                        document.getElementById('rate-parking-display').textContent = s.value;
                        document.getElementById('rate-parking-input').value = s.value;
                        localStorage.setItem('smartpark_rate_per_hour', s.value);
                    }
                    if (s.key === 'smartpark_fine_amount') {
                        document.getElementById('fine-amount-display').textContent = s.value;
                        document.getElementById('fine-amount-input').value = s.value;
                        localStorage.setItem('smartpark_fine_amount', s.value);
                    }
                });
                updateParkingStats();
            })
            .catch(err => console.error('[SETTINGS] Load error:', err));

        loadTableData();
        loadResidentsData();
        startGateMonitors();
        refreshInterval = setInterval(() => {
            loadTableData();
            loadResidentsData();
            pollGateNotifications();
        }, 3000);



        // Tab Navigation
        const tabDashboard = document.getElementById('tab-dashboard');
        const tabGate = document.getElementById('tab-gate');
        const tabResidents = document.getElementById('tab-residents');
        const tabHistory = document.getElementById('tab-history');
        const tabParkingLot = document.getElementById('tab-parking-lot');
        const tabBlocked = document.getElementById('tab-blocked');

        const viewDashboard = document.getElementById('dashboard-view');
        const viewGate = document.getElementById('gate-view');
        const viewResidents = document.getElementById('residents-view');
        const viewHistory = document.getElementById('history-view');
        const viewParkingLot = document.getElementById('parking-lot-view');
        const viewBlocked = document.getElementById('blocked-view');

        const allTabs = [tabDashboard, tabGate, tabResidents, tabHistory, tabParkingLot, tabBlocked];
        const allViews = [viewDashboard, viewGate, viewResidents, viewHistory, viewParkingLot, viewBlocked];

        function switchTab(activeTab, activeView) {
            allTabs.forEach(t => t.classList.remove('active'));
            allViews.forEach(v => v.style.display = 'none');

            activeTab.classList.add('active');
            activeView.style.display = 'block';
        }

        tabDashboard.addEventListener('click', (e) => {
            e.preventDefault();
            stopAdminCamera();
            switchTab(tabDashboard, viewDashboard);
            startDashboardCamera();
            startGateMonitors();
        });

        tabGate.addEventListener('click', (e) => {
            e.preventDefault();
            stopAdminCamera();
            switchTab(tabGate, viewGate);
            startGateMonitors();
        });

        tabResidents.addEventListener('click', (e) => {
            e.preventDefault();
            stopAdminCamera();
            switchTab(tabResidents, viewResidents);
            loadResidentsData();
        });

        tabHistory.addEventListener('click', (e) => {
            e.preventDefault();
            stopAdminCamera();
            switchTab(tabHistory, viewHistory);
        });

        tabParkingLot.addEventListener('click', (e) => {
            e.preventDefault();
            stopAdminCamera();
            switchTab(tabParkingLot, viewParkingLot);
            loadParkingLot();
        });

        tabBlocked.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(tabBlocked, viewBlocked);
            stopAdminCamera();
            loadBlockedVisitors();
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', (e) => {
            e.preventDefault();
            sessionStorage.removeItem('smartpark_admin_auth');
            sessionStorage.removeItem('smartpark_admin_time');
            dashboardInitialized = false;
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
            if (typeof stopAdminCamera === 'function') {
                stopAdminCamera();
            }
            showLogin();
        });

        // Editable Total Parking
        const editBtn = document.getElementById('edit-total-btn');
        const totalDisplay = document.getElementById('total-parking-display');
        const totalInput = document.getElementById('total-parking-input');
        let isEditing = false;

        editBtn.addEventListener('click', () => {
            if (!isEditing) {
                totalDisplay.style.display = 'none';
                totalInput.style.display = 'block';
                totalInput.focus();
                totalInput.select();
                isEditing = true;
            } else {
                saveTotal();
            }
        });

        totalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                saveTotal();
            } else if (e.key === 'Escape') {
                cancelEdit();
            }
        });

        totalInput.addEventListener('blur', () => {
            setTimeout(() => saveTotal(), 100);
        });

        function saveTotal() {
            const val = parseInt(totalInput.value);
            if (val && val > 0) {
                totalDisplay.textContent = val;
                localStorage.setItem('smartpark_total_parking', val);
                // Save to backend
                fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'smartpark_total_parking', value: val.toString() })
                }).catch(err => console.error('[SETTINGS] Save error:', err));
            }
            totalDisplay.style.display = 'inline';
            totalInput.style.display = 'none';
            isEditing = false;
            updateParkingStats();
        }

        function cancelEdit() {
            totalDisplay.style.display = 'inline';
            totalInput.style.display = 'none';
            totalInput.value = totalDisplay.textContent;
            isEditing = false;
        }

        // Editable Hourly Rate
        const editRateBtn = document.getElementById('edit-rate-btn');
        const rateDisplay = document.getElementById('rate-parking-display');
        const rateInput = document.getElementById('rate-parking-input');
        let isEditingRate = false;

        editRateBtn.addEventListener('click', () => {
            if (!isEditingRate) {
                rateDisplay.style.display = 'none';
                rateInput.style.display = 'block';
                rateInput.focus();
                rateInput.select();
                isEditingRate = true;
            } else {
                saveRate();
            }
        });

        rateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveRate();
            else if (e.key === 'Escape') cancelEditRate();
        });

        rateInput.addEventListener('blur', () => {
            setTimeout(() => saveRate(), 100);
        });

        function saveRate() {
            const val = parseFloat(rateInput.value);
            if (val >= 0) {
                rateDisplay.textContent = val;
                localStorage.setItem('smartpark_rate_per_hour', val);
                // Save to backend
                fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'smartpark_rate_per_hour', value: val.toString() })
                }).catch(err => console.error('[SETTINGS] Save error:', err));
            }
            rateDisplay.style.display = 'inline';
            rateInput.style.display = 'none';
            isEditingRate = false;
        }

        function cancelEditRate() {
            rateDisplay.style.display = 'inline';
            rateInput.style.display = 'none';
            rateInput.value = rateDisplay.textContent;
            isEditingRate = false;
        }

        // Editable Fine Amount
        const editFineBtn = document.getElementById('edit-fine-btn');
        const fineDisplay = document.getElementById('fine-amount-display');
        const fineInput = document.getElementById('fine-amount-input');
        let isEditingFine = false;

        editFineBtn.addEventListener('click', () => {
            if (!isEditingFine) {
                fineDisplay.style.display = 'none';
                fineInput.style.display = 'block';
                fineInput.focus();
                fineInput.select();
                isEditingFine = true;
            } else {
                saveFine();
            }
        });

        fineInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveFine();
            else if (e.key === 'Escape') cancelEditFine();
        });

        fineInput.addEventListener('blur', () => {
            setTimeout(() => saveFine(), 100);
        });

        function saveFine() {
            const val = parseInt(fineInput.value);
            if (val >= 0) {
                fineDisplay.textContent = val;
                localStorage.setItem('smartpark_fine_amount', val);
                // Save to backend
                fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'smartpark_fine_amount', value: val.toString() })
                }).catch(err => console.error('[SETTINGS] Save error:', err));
            }
            fineDisplay.style.display = 'inline';
            fineInput.style.display = 'none';
            isEditingFine = false;
        }

        function cancelEditFine() {
            fineDisplay.style.display = 'inline';
            fineInput.style.display = 'none';
            fineInput.value = fineDisplay.textContent;
            isEditingFine = false;
        }
    }
});

// ============================================
// DASHBOARD DATA FUNCTIONS (global scope)
// ============================================
function getTotalParking() {
    const saved = localStorage.getItem('smartpark_total_parking');
    return saved ? parseInt(saved) : 50;
}

function getFineAmount() {
    const saved = localStorage.getItem('smartpark_fine_amount');
    return saved ? parseInt(saved) : 50;
}

function updateParkingStats(activeCount) {
    const total = getTotalParking();
    const occupied = activeCount || 0;
    const available = Math.max(total - occupied, 0);

    document.getElementById('occupied-count').textContent = occupied;
    document.getElementById('available-count').textContent = available;
}

async function loadTableData() {
    try {
        const res = await fetch('/api/visitors');
        const entries = await res.json();

        const logsBody = document.getElementById('logs-body');
        const emptyState = document.getElementById('empty-state');
        const activeCountEl = document.getElementById('active-count');

        if (!entries || entries.length === 0) {
            logsBody.innerHTML = '';
            emptyState.classList.remove('hidden');
            activeCountEl.textContent = '0';
            updateParkingStats(0);
            const revenueEl = document.getElementById('revenue-month');
            if (revenueEl) revenueEl.textContent = '₹0.00';
            return;
        }

        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

        const dashboardEntries = [];
        const historyEntries = [];

        let currentMonthRevenue = 0;
        const currentMonth = new Date(now).getMonth();
        const currentYear = new Date(now).getFullYear();

        // Sort so newest are on top (by entry time)
        entries.sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));

        entries.forEach(entry => {
            const entryMs = new Date(entry.entryTime).getTime();
            const ageMs = now - entryMs;

            // Past 24 hours -> Dashboard
            if (ageMs <= ONE_DAY_MS) {
                dashboardEntries.push(entry);
                historyEntries.push(entry); // Keep in history too
            }
            // Past 3 months -> History only
            else if (ageMs <= THREE_MONTHS_MS) {
                historyEntries.push(entry);
            }
            // Older than 3 months -> drop (unless you want to keep them in DB forever)

            // Calculate revenue for the current month
            if (entry.exitTime && entry.totalCharge) {
                const exitDate = new Date(entry.exitTime);
                if (exitDate.getMonth() === currentMonth && exitDate.getFullYear() === currentYear) {
                    currentMonthRevenue += Number(entry.totalCharge) || 0;
                }
            }
        });

        const revenueEl = document.getElementById('revenue-month');
        if (revenueEl) revenueEl.textContent = `₹${currentMonthRevenue.toFixed(2)}`;

        const historyBody = document.getElementById('history-body');
        const historyEmptyState = document.getElementById('empty-state-history');

        // Render Dashboard Table
        if (dashboardEntries.length === 0) {
            logsBody.innerHTML = '';
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
        }

        let activeCount = 0;
        logsBody.innerHTML = '';

        dashboardEntries.forEach(entry => {
            const isCompleted = !!entry.exitTime;
            if (!isCompleted) activeCount++;
            logsBody.appendChild(createRowHTML(entry, isCompleted));
        });

        // Render History Table
        if (historyEntries.length === 0) {
            historyBody.innerHTML = '';
            historyEmptyState.classList.remove('hidden');
        } else {
            historyEmptyState.classList.add('hidden');
        }

        historyBody.innerHTML = '';
        historyEntries.forEach(entry => {
            const isCompleted = !!entry.exitTime;
            historyBody.appendChild(createRowHTML(entry, isCompleted));
        });

        function createRowHTML(entry, isCompleted) {
            let statusHtml = '';
            if (isCompleted) {
                statusHtml = `<span class="status-badge status-completed">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Completed
                </span>`;
            } else {
                statusHtml = `<span class="status-badge status-active">
                    <span class="dot active-dot" style="margin-right: 4px; box-shadow:none;"></span>
                    Active
                </span>`;
            }

            const entryTime = new Date(entry.entryTime).toLocaleString();
            const exitTime = entry.exitTime ? new Date(entry.exitTime).toLocaleString() : '-';
            const charge = entry.totalCharge ? `₹${entry.totalCharge.toFixed(2)}` : (isCompleted ? '₹0.00' : 'Accruing...');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${statusHtml}</td>
                <td style="font-weight: 500;">${entry.name}</td>
                <td style="color: var(--text-muted);">${entry.phone}</td>
                <td><span class="plate">${entry.licensePlate}</span></td>
                <td style="font-weight: 600; color: var(--highlight);">${entry.visitingFlat || '-'}</td>
                <td style="color: var(--text-muted); font-size: 13px;">${entryTime}</td>
                <td style="color: var(--text-muted); font-size: 13px;">${exitTime}</td>
                <td class="money">${charge}</td>
            `;
            return tr;
        }

        activeCountEl.textContent = activeCount;
        updateParkingStats(activeCount);
        // Ensure sidebar/tab badges update with server data
        if (typeof pollGateNotifications === 'function') {
            pollGateNotifications();
        }
    } catch (err) {
        console.error("Failed to load table data", err);
    }
}

async function loadResidentsData() {
    try {
        const res = await fetch('/api/residents');
        const residents = await res.json();

        const residentsBody = document.getElementById('residents-body');
        const emptyState = document.getElementById('empty-state-residents');

        if (!residentsBody) return; // safeguard

        if (!residents || residents.length === 0) {
            residentsBody.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        // Sort by Base Flat ID, then logic to put Resident before Tenant
        residents.sort((a, b) => {
            if (a.baseFlatId === b.baseFlatId) {
                return a.role === 'Resident' ? -1 : 1;
            }
            return a.baseFlatId.localeCompare(b.baseFlatId);
        });

        residentsBody.innerHTML = '';

        residents.forEach(resident => {
            const badgeColor = resident.role === 'Tenant' ? 'var(--secondary)' : 'var(--primary)';
            const roleBadge = `<span style="background-color: ${badgeColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">${resident.role}</span>`;

            const availColor = resident.isAvailable !== false ? 'var(--success)' : 'var(--danger)';
            const availText = resident.isAvailable !== false ? 'Available' : 'Unavailable';
            const availBadge = `<span style="color: ${availColor}; font-size: 13px; font-weight: 500;">${availText}</span>`;

            const rawPlates = resident.carPlate || 'N/A';
            const platesHtml = rawPlates === 'N/A' ? `<span class="plate">N/A</span>` : rawPlates.split(',').map(p => `<span class="plate" style="margin-right:4px;">${p.trim()}</span>`).join('');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${roleBadge}</td>
                <td style="font-weight: 600;">${resident.flatInput}</td>
                <td style="font-weight: 500;">${resident.name}</td>
                <td style="color: var(--text-muted);">${resident.phone}</td>
                <td>${platesHtml}</td>
                <td>${availBadge}</td>
            `;
            residentsBody.appendChild(tr);
        });
    } catch (err) {
        console.error("Failed to load residents data", err);
    }
}

// ============================================
// GATE NOTIFICATION POLLING
// ============================================

// Track which notification IDs are currently displayed to avoid duplicates
// Track which notification IDs are currently displayed to avoid duplicates
const _shownGateNotifs = new Set(JSON.parse(localStorage.getItem('admin_shown_notifs')) || []);
// Track which notification IDs the admin has ALREADY acted on (opened/dismissed)
const _processedGateNotifs = new Set(JSON.parse(localStorage.getItem('admin_processed_notifs')) || []);

function saveNotifState() {
    localStorage.setItem('admin_shown_notifs', JSON.stringify(Array.from(_shownGateNotifs)));
    localStorage.setItem('admin_processed_notifs', JSON.stringify(Array.from(_processedGateNotifs)));
}

let _isPollingGateNotifs = false;

async function pollGateNotifications() {
    if (_isPollingGateNotifs) return;
    // Only run if dashboard is visible (admin is logged in)
    const dashboard = document.getElementById('admin-dashboard');
    if (!dashboard || !dashboard.classList.contains('active')) return;

    _isPollingGateNotifs = true;
    try {
        const res = await fetch('/api/gate-notifications');
        if (!res.ok) return;
        const notifications = await res.json();

        const stack = document.getElementById('gate-alert-stack');
        if (!stack) return;

        const pendingIds = new Set((notifications || []).map(n => String(n.id)));

        // Cleanup: remove IDs from our tracker sets if they are no longer pending on the server
        _shownGateNotifs.forEach(id => {
            if (!pendingIds.has(id)) {
                _shownGateNotifs.delete(id);
                const el = document.getElementById(`gate-alert-${id}`);
                if (el) el.remove();
            }
        });
        saveNotifState();


        // Add new alert cards for new notifications
        (notifications || []).forEach(notif => {
            const notifIdStr = String(notif.id);
            if (_shownGateNotifs.has(notifIdStr)) return; // already shown
            if (_processedGateNotifs.has(notifIdStr)) return; // already acted on by admin

            _shownGateNotifs.add(notifIdStr);
            saveNotifState();

            // Play alert sound
            playGateAlert();

            // Build the card
            const card = document.createElement('div');
            card.className = 'gate-alert';
            card.id = `gate-alert-${notifIdStr}`;

            const timeStr = new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let title = '⚡ GATE OPEN REQUEST';
            let subtitle = `Resident approved entry · ${timeStr}`;
            let icon = '🚦';
            let actionHtml = `
                <button class="gate-open-btn" onclick="openGate('${notif.id}', this)">
                    🔓 Open Gate
                </button>
                <button class="gate-dismiss-btn" onclick="dismissGateAlert('${notif.id}', this)" title="Dismiss without opening">
                    ✕
                </button>
            `;

            if (notif.type === 'denied') {
                title = '❌ REQUEST DENIED';
                subtitle = `Resident rejected entry · ${timeStr}`;
                icon = '🚫';
                actionHtml = `
                    <button class="gate-dismiss-btn" style="width:100%; height: 36px; display: flex; align-items: center; justify-content: center; font-weight: 600;" onclick="dismissGateAlert('${notif.id}', this)">
                        Dismiss Alert
                    </button>
                `;
            } else if (notif.type === 'blocked') {
                title = '🛑 VISITOR BLOCKED';
                subtitle = `Resident blocked this visitor · ${timeStr}`;
                icon = '⛔';
                actionHtml = `
                    <button class="gate-dismiss-btn" style="width:100%; height: 36px; display: flex; align-items: center; justify-content: center; font-weight: 600;" onclick="dismissGateAlert('${notif.id}', this)">
                        Dismiss Alert
                    </button>
                `;
            }

            card.innerHTML = `
                <div class="gate-alert-header">
                    <div class="gate-alert-icon">${icon}</div>
                    <div>
                        <div class="gate-alert-title">${title}</div>
                        <div class="gate-alert-subtitle">${subtitle}</div>
                    </div>
                </div>
                <div class="gate-alert-visitor">${escapeHtml(notif.visitorName)}</div>
                <div class="gate-alert-details">
                    <span class="gate-alert-chip">🏠 <strong>${escapeHtml(notif.visitingFlat || 'N/A')}</strong></span>
                    <span class="gate-alert-chip">🚗 <strong>${escapeHtml(notif.licensePlate || 'N/A')}</strong></span>
                    <span class="gate-alert-chip">📞 <strong>${escapeHtml(notif.visitorPhone || '-')}</strong></span>
                </div>
                <div class="gate-alert-actions">
                    ${actionHtml}
                </div>
            `;

            stack.appendChild(card);
        });

        const validNotifs = (notifications || []).filter(n => !_processedGateNotifs.has(String(n.id)));
        const activeNotifCount = validNotifs.length;
        updateGateBadge(activeNotifCount);

        // ── Also update the Gate Control panel + sidebar tab badge ───────────
        renderGateView(notifications || []);
        updateGateTabBadge(activeNotifCount);

    } catch (err) {
        // Silently fail — don't spam console on network hiccups
    } finally {
        _isPollingGateNotifs = false;
    }
}

// ── Render the Gate Control dedicated view ───────────────────────────────────
function renderGateView(notifications) {
    const container = document.getElementById('gate-cards-container');
    const emptyEl = document.getElementById('gate-view-empty');
    if (!container || !emptyEl) return;

    if (!notifications || notifications.length === 0) {
        container.innerHTML = '';
        emptyEl.style.display = 'flex';
        return;
    }

    emptyEl.style.display = 'none';

    const existingIds = new Set(
        Array.from(container.querySelectorAll('.gv-card')).map(el => el.dataset.id)
    );
    const incomingIds = new Set(notifications.map(n => String(n.id)));

    // Remove stale or processed cards
    existingIds.forEach(id => {
        if (!incomingIds.has(id) || _processedGateNotifs.has(id)) {
            const el = container.querySelector(`.gv-card[data-id="${id}"]`);
            if (el) { el.style.animation = 'gateDismiss 0.3s ease forwards'; setTimeout(() => el.remove(), 320); }
        }
    });

    // Add new cards
    notifications.forEach(notif => {
        const idStr = String(notif.id);
        if (existingIds.has(idStr)) return;
        if (_processedGateNotifs.has(idStr)) return; // Skip if admin just handled it

        const timeStr = new Date(notif.createdAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

        const isApproval = notif.type === 'approved' || !notif.type;
        const isDenied = notif.type === 'denied';
        const isBlocked = notif.type === 'blocked';

        let badgeTitle = 'Resident Approved — Gate Request';
        let badgeColor = '#10b981';
        let badgeIcon = '🚦';
        let bgGradient = 'linear-gradient(135deg,#0f1f30 0%,#0a1628 100%)';
        let borderShadow = 'rgba(16,185,129,0.35)';

        if (isDenied) {
            badgeTitle = 'Resident Denied — Entry Rejected';
            badgeColor = '#ef4444';
            badgeIcon = '🚫';
            borderShadow = 'rgba(239,68,68,0.35)';
        } else if (isBlocked) {
            badgeTitle = 'Resident Action — Visitor Blocked';
            badgeColor = '#f59e0b';
            badgeIcon = '🛑';
            borderShadow = 'rgba(245,158,11,0.35)';
        }

        const card = document.createElement('div');
        card.className = 'gv-card';
        card.dataset.id = idStr;

        card.style.cssText = [
            `background:${bgGradient}`,
            `border:1.5px solid ${borderShadow}`,
            'border-radius:16px',
            'padding:24px 28px',
            'display:flex',
            'align-items:center',
            'justify-content:space-between',
            'gap:24px',
            'flex-wrap:wrap',
            'animation:gateSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
            'position:relative',
            'overflow:hidden'
        ].join(';');

        card.innerHTML = `
            <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${badgeColor};border-radius:16px 0 0 16px;"></div>
            <div style="flex:1;min-width:200px;padding-left:8px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:${badgeColor}26;border:1px solid ${badgeColor}4D;display:flex;align-items:center;justify-content:center;font-size:20px;">${badgeIcon}</div>
                    <div>
                        <div style="font-size:11px;font-weight:700;color:${badgeColor};letter-spacing:0.8px;text-transform:uppercase;">${badgeTitle}</div>
                        <div style="font-size:12px;color:rgba(148,163,184,0.7);margin-top:2px;">${timeStr}</div>
                    </div>
                </div>
                <div style="font-size:20px;font-weight:700;color:#f8fafc;margin-bottom:12px;">${escapeHtml(notif.visitorName)}</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:5px 10px;font-size:13px;color:#94a3b8;">🏠 <strong style="color:#f1f5f9;">${escapeHtml(notif.visitingFlat || 'N/A')}</strong></span>
                    <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:5px 10px;font-size:13px;color:#94a3b8;">🚗 <strong style="color:#f1f5f9;">${escapeHtml(notif.licensePlate || 'N/A')}</strong></span>
                    <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:5px 10px;font-size:13px;color:#94a3b8;">📞 <strong style="color:#f1f5f9;">${escapeHtml(notif.visitorPhone || '—')}</strong></span>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;min-width:160px;">
                ${isApproval ? `
                <button onclick="openGateFromView('${notif.id}',this)"
                    style="padding:14px 24px;border:none;border-radius:12px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-size:15px;font-weight:700;font-family:'Inter',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.18s ease;white-space:nowrap;box-shadow:0 4px 20px rgba(16,185,129,0.3);"
                    onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 28px rgba(16,185,129,0.45)';"
                    onmouseout="this.style.transform='';this.style.boxShadow='0 4px 20px rgba(16,185,129,0.3);';"
                >🔓 Open Gate</button>
                ` : ''}
                <button onclick="dismissFromView('${notif.id}')"
                    style="padding:10px 24px;border:1px solid rgba(255,255,255,0.12);border-radius:12px;background:rgba(255,255,255,0.04);color:#64748b;font-size:13px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;transition:all 0.18s ease; width: 100%;"
                    onmouseover="this.style.background='rgba(255,255,255,0.09)';this.style.color='#94a3b8';"
                    onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='#64748b';"
                >Dismiss</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function _removeGvCard(notifId) {
    const card = document.querySelector(`.gv-card[data-id="${notifId}"]`);
    if (card) {
        card.style.animation = 'gateDismiss 0.3s ease forwards';
        setTimeout(() => {
            card.remove();
            if (!document.querySelector('.gv-card')) {
                const em = document.getElementById('gate-view-empty');
                if (em) em.style.display = 'flex';
            }
        }, 320);
    }
}

function updateGateTabBadge(count) {
    const badge = document.getElementById('gate-tab-badge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
}

async function openGateFromView(notifId, btnEl) {
    const idStr = String(notifId);
    let originalText = '';
    if (btnEl) {
        originalText = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = 'Opening...';
    }

    try {
        const res = await fetch('/api/gate-notifications/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notifId })
        });
        const data = await res.json();

        if (data.success) {
            _processedGateNotifs.add(idStr);
            _shownGateNotifs.delete(idStr);
            saveNotifState();

            if (btnEl) {
                btnEl.innerHTML = '✅ Gate Opened!';
                btnEl.style.background = 'linear-gradient(135deg,#059669,#047857)';
            }
            // Animate out after a brief "opened" flash
            setTimeout(() => {
                removeGateCard(notifId);
                _removeGvCard(notifId);
            }, 1200);
        } else {
            throw new Error(data.message || 'Server failed to open gate');
        }
    } catch (e) {
        console.error('[GATE] Open error:', e);
        alert('Failed to open gate: ' + e.message);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalText;
        }
    }
}

async function dismissFromView(notifId) {
    const idStr = String(notifId);
    try {
        const res = await fetch('/api/gate-notifications/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notifId })
        });
        const data = await res.json();
        if (data.success) {
            _processedGateNotifs.add(idStr);
            _shownGateNotifs.delete(idStr);
            saveNotifState();
            removeGateCard(notifId);
            _removeGvCard(notifId);
        } else {
            console.error('[GATE] Dismiss failed:', data.message);
        }
    } catch (e) {
        console.error('[GATE] Dismiss error:', e);
    }
}

async function openGate(notifId, btnEl) {
    const idStr = String(notifId);
    let originalText = '';
    if (btnEl) {
        originalText = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = 'Opening...';
    }

    try {
        const res = await fetch('/api/gate-notifications/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notifId })
        });
        const data = await res.json();

        if (data.success) {
            _processedGateNotifs.add(idStr);
            _shownGateNotifs.delete(idStr);
            saveNotifState();

            if (btnEl) {
                btnEl.innerHTML = '✅ Gate Opened!';
                btnEl.style.background = 'linear-gradient(135deg, #059669, #047857)';
            }
            // Animate out after a brief "opened" flash
            setTimeout(() => removeGateCard(notifId), 1200);
        } else {
            throw new Error(data.message || 'Server failed to open gate');
        }
    } catch (err) {
        console.error('[GATE] Dismiss error:', err);
        alert('Failed to open gate: ' + err.message);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalText;
        }
    }
}

async function dismissGateAlert(notifId, btnEl) {
    const idStr = String(notifId);
    try {
        const res = await fetch('/api/gate-notifications/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notifId })
        });
        const data = await res.json();
        if (data.success) {
            _processedGateNotifs.add(idStr);
            _shownGateNotifs.delete(idStr);
            saveNotifState();
            removeGateCard(notifId);
        }
    } catch (err) {
        console.error('[GATE] Dismiss error:', err);
    }
}

function removeGateCard(notifId) {
    const idStr = String(notifId);
    // Track it as processed so it doesn't pop back up during late polls
    _processedGateNotifs.add(idStr);
    saveNotifState();

    const card = document.getElementById(`gate-alert-${idStr}`);
    if (card) {
        card.style.animation = 'gateDismiss 0.3s ease forwards';
        setTimeout(() => {
            card.remove();
        }, 320);
    }
    // DO NOT delete from _shownGateNotifs here. 
    // Let pollGateNotifications handle the cleanup once the server confirms status is no longer pending.
    // This prevents the "reappearing" bug if the poll hits before the database updates.

    // Update badge based on remaining cards in stack
    const stack = document.getElementById('gate-alert-stack');
    if (stack) {
        updateGateBadge(stack.querySelectorAll('.gate-alert').length);
    }
}

function updateGateBadge(count) {
    // Add/update a red badge on the Dashboard nav item
    const tabDashboard = document.getElementById('tab-dashboard');
    if (!tabDashboard) return;

    let badge = document.getElementById('gate-notif-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'gate-notif-badge';
            badge.className = 'gate-notif-badge';
            tabDashboard.appendChild(badge);
        }
        badge.textContent = count;
        badge.style.animation = 'none';
        requestAnimationFrame(() => { badge.style.animation = ''; });
    } else {
        if (badge) badge.remove();
    }
}

function playGateAlert() {
    try {
        // Short double-beep using Web Audio API — no external file needed
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 180].forEach(delayMs => {
            setTimeout(() => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
                gain.gain.setValueAtTime(0.18, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.2);
            }, delayMs);
        });
    } catch (e) {
        // Audio blocked — silently ignore
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Start polling gate notifications every 3 seconds
setInterval(pollGateNotifications, 3000);
// Also poll immediately on load
pollGateNotifications();

let parkingLotInterval = null;

async function loadParkingLot() {
    // Clear any existing auto-refresh so we don't stack intervals
    if (parkingLotInterval) {
        clearInterval(parkingLotInterval);
    }

    await renderParkingLot();

    // Auto-refresh every 5 seconds while this tab is open
    parkingLotInterval = setInterval(async () => {
        const view = document.getElementById('parking-lot-view');
        if (view && view.style.display !== 'none') {
            await renderParkingLot();
        } else {
            clearInterval(parkingLotInterval);
            parkingLotInterval = null;
        }
    }, 5000);
}

async function renderParkingLot() {
    const total = getTotalParking(); // uses saved localStorage value

    // Fetch currently active visitors (no exitTime)
    let activeVisitors = [];
    try {
        const res = await fetch('/api/visitors');
        const all = await res.json();
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        activeVisitors = (all || []).filter(v => {
            if (v.exitTime) return false;
            const age = now - new Date(v.entryTime).getTime();
            return age <= ONE_DAY_MS;
        });
    } catch (e) {
        console.error('Parking lot fetch error', e);
    }

    // Distribute total spots across 3 rows (A, B, C)
    const rowA = Math.ceil(total / 3);
    const rowB = Math.ceil((total - rowA) / 2);
    const rowC = total - rowA - rowB;

    const rows = [
        { id: 'pl-grid-a', prefix: 'A', count: rowA, start: 1 },
        { id: 'pl-grid-b', prefix: 'B', count: rowB, start: rowA + 1 },
        { id: 'pl-grid-c', prefix: 'C', count: rowC, start: rowA + rowB + 1 },
    ];

    const nonSuffixedActive = activeVisitors.filter(v => !(v.id && v.id.includes('-')));
    let oldIndex = 0;

    rows.forEach(row => {
        const grid = document.getElementById(row.id);
        if (!grid) return;
        grid.innerHTML = '';

        for (let i = 0; i < row.count; i++) {
            const isWheelchair = (i === 0); // First slot in every row
            const label = `${row.prefix}${String(i + 1).padStart(2, '0')}`;

            let visitor = activeVisitors.find(v => v.id && v.id.includes('-') && v.id.split('-')[1] === label);
            if (!visitor && oldIndex < nonSuffixedActive.length) {
                visitor = nonSuffixedActive[oldIndex++];
            }

            const spot = document.createElement('div');

            let tooltipHTML = '';
            if (isWheelchair) {
                spot.className = `pl-spot wheelchair ${visitor ? 'occupied' : 'available'}`;
                if (visitor) {
                    const since = new Date(visitor.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    tooltipHTML = `
                        <div class="pl-tooltip-name">♿ ${visitor.name}</div>
                        <div class="pl-tooltip-detail">📋 ${visitor.licensePlate}</div>
                        <div class="pl-tooltip-detail">🏠 ${visitor.visitingFlat || 'N/A'}</div>
                        <div class="pl-tooltip-detail">⏱ Since ${since}</div>
                    `;
                } else {
                    tooltipHTML = `<div class="pl-tooltip-name">Spot ${label}</div><div class="pl-tooltip-detail" style="color:#38bdf8;">♿ Accessible – Reserved</div>`;
                }
                spot.innerHTML = `
                    <div class="pl-spot-num">${label}</div>
                    <div class="pl-spot-icon">♿</div>
                    ${visitor ? `<div class="pl-spot-plate">${visitor.licensePlate}</div>` : ''}
                    <div class="pl-tooltip">${tooltipHTML}</div>
                `;
            } else {
                spot.className = `pl-spot ${visitor ? 'occupied' : 'available'}`;
                if (visitor) {
                    const since = new Date(visitor.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    tooltipHTML = `
                        <div class="pl-tooltip-name">🚗 ${visitor.name}</div>
                        <div class="pl-tooltip-detail">📋 ${visitor.licensePlate}</div>
                        <div class="pl-tooltip-detail">🏠 ${visitor.visitingFlat || 'N/A'}</div>
                        <div class="pl-tooltip-detail">⏱ Since ${since}</div>
                    `;
                } else {
                    tooltipHTML = `<div class="pl-tooltip-name">Spot ${label}</div><div class="pl-tooltip-detail" style="color: var(--success);">Available</div>`;
                }
                spot.innerHTML = `
                    <div class="pl-spot-num">${label}</div>
                    <div class="pl-spot-icon">🚗</div>
                    ${visitor ? `<div class="pl-spot-plate">${visitor.licensePlate}</div>` : ''}
                    <div class="pl-tooltip">${tooltipHTML}</div>
                `;
            }

            grid.appendChild(spot);
        }
    });
}


// ============================================
// BLOCKED VISITORS (admin-wide)
// ============================================

let _allBlockedVisitors = [];

async function loadBlockedVisitors() {
    try {
        const res = await fetch('/api/blocked-visitors/all');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _allBlockedVisitors = await res.json();
    } catch (err) {
        console.error('Failed to load blocked visitors:', err);
        _allBlockedVisitors = [];
    }
    renderBlockedTable(_allBlockedVisitors);

    // Wire up live search (attach only once)
    const searchEl = document.getElementById('blocked-search');
    if (searchEl && !searchEl._wired) {
        searchEl._wired = true;
        searchEl.addEventListener('input', () => {
            const q = searchEl.value.trim().toLowerCase();
            if (!q) {
                renderBlockedTable(_allBlockedVisitors);
                return;
            }
            const filtered = _allBlockedVisitors.filter(b =>
                (b.visitorName || '').toLowerCase().includes(q) ||
                (b.visitorPhone || '').includes(q) ||
                (b.residentFlatId || '').toLowerCase().includes(q)
            );
            renderBlockedTable(filtered);
        });
    }
}

function renderBlockedTable(list) {
    const tbody = document.getElementById('blocked-body');
    const emptyState = document.getElementById('empty-state-blocked');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tbody.innerHTML = '';

    list.forEach((b, idx) => {
        const blockedAt = b.blockedAt
            ? new Date(b.blockedAt).toLocaleString()
            : '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 13px;">${idx + 1}</td>
            <td style="font-weight: 500;">${escapeHtml(b.visitorName || '—')}</td>
            <td style="color: var(--text-muted);">${escapeHtml(b.visitorPhone || '—')}</td>
            <td style="font-weight: 600; color: var(--highlight);">${escapeHtml(b.residentFlatId || '—')}</td>
            <td style="color: var(--text-muted); font-size: 13px;">${blockedAt}</td>
            <td>
                <button
                    onclick="adminUnblockVisitor('${escapeHtml(b.residentFlatId)}', '${escapeHtml(b.visitorPhone)}', this)"
                    style="padding: 5px 12px; border-radius: 8px; border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.08); color: #ef4444; font-size: 12px; font-weight: 600; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.18s ease;"
                    onmouseover="this.style.background='rgba(239,68,68,0.18)'"
                    onmouseout="this.style.background='rgba(239,68,68,0.08)'"
                >
                    Unblock
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function adminUnblockVisitor(residentFlatId, visitorPhone, btnEl) {
    if (!confirm(`Unblock ${visitorPhone} from flat ${residentFlatId}?`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'Unblocking…';
    }

    try {
        const res = await fetch('/api/blocked-visitors', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ residentFlatId, visitorPhone })
        });
        const data = await res.json();
        if (data.success) {
            // Reload the table
            await loadBlockedVisitors();
        } else {
            alert('Failed to unblock: ' + (data.message || 'Unknown error'));
            if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Unblock'; }
        }
    } catch (err) {
        console.error('Unblock error:', err);
        alert('Network error, please try again.');
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Unblock'; }
    }
}

// =============================================
// ADMIN EXIT CAMERA & OCR LOGIC
// =============================================
let adminTesseractWorker = null;
let adminGateIsScanning = false;
let _activeStreams = {}; // { 'gate': stream, 'monitor': stream }

// Initialize Tesseract on load
(async () => {
    if (typeof Tesseract !== 'undefined') {
        adminTesseractWorker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text' && m.progress % 0.5 < 0.1) {
                    console.log(`Admin OCR: ${(m.progress * 100).toFixed(0)}%`);
                }
            }
        });
        await adminTesseractWorker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
        });
        console.log("Admin exit Tesseract ready.");
    }
})();

function preprocessAdminPlate(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Zoom/crop central 60%
    const cropW = width * 0.6;
    const cropH = height * 0.6;
    const cropX = (width - cropW) / 2;
    const cropY = (height - cropH) / 2;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW;
    tempCanvas.height = cropH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Filter
    const imgData = tempCtx.getImageData(0, 0, cropW, cropH);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        let gray = r * 0.3 + g * 0.59 + b * 0.11;
        gray = gray < 120 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = gray;
    }
    tempCtx.putImageData(imgData, 0, 0);
    return tempCanvas;
}

function normaliseAdminOCR(text) {
    return text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function adminFuzzyMatch(a, b) {
    if (a === b) return true;
    if (b.includes(a) || a.includes(b)) return true;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen < 4) return false;
    let diffs = Math.abs(a.length - b.length);
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
        if (a[i] !== b[i]) diffs++;
    }
    return diffs <= 2;
}

async function startDashboardCamera() {
    if (_activeStreams['monitor']) return;
    const video = document.getElementById('dash-cctv-video');
    if (!video) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: 'environment' } }
        });
        _activeStreams['monitor'] = stream;
        video.srcObject = stream;
        document.getElementById('dash-cctv-status').textContent = 'Live';
    } catch (e) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            _activeStreams['monitor'] = stream;
            video.srcObject = stream;
            document.getElementById('dash-cctv-status').textContent = 'Live';
        } catch (err) {
            document.getElementById('dash-cctv-status').textContent = 'Camera Error';
            return;
        }
    }
    startDashboardScan();
}

function stopAdminCamera() {
    Object.keys(_activeStreams).forEach(key => {
        if (_activeStreams[key]) {
            _activeStreams[key].getTracks().forEach(t => t.stop());
            delete _activeStreams[key];
        }
    });
    adminGateIsScanning = false;
}

// Dashboard camera continuous scan
async function startDashboardScan() {
    const video = document.getElementById('dash-cctv-video');
    const canvas = document.getElementById('dash-snapshot-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const statusMsg = document.getElementById('dash-cctv-status');
    const overlay = document.getElementById('detected-plate-dashboard');

    const entryWrap = document.getElementById('dash-match-entry-result');
    const entryText = document.getElementById('dash-match-entry-text');
    const entryBtn = document.getElementById('btn-dash-open-entry');

    const exitWrap = document.getElementById('dash-match-exit-result');
    const exitPlateText = document.getElementById('dash-match-exit-plate');
    const exitChargeText = document.getElementById('dash-match-exit-charge');

    if (!adminTesseractWorker) {
        statusMsg.textContent = "OCR engine loading...";
        setTimeout(startDashboardScan, 2000);
        return;
    }

    adminGateIsScanning = true;
    statusMsg.textContent = "Scanning for plates...";

    while (adminGateIsScanning) {
        await new Promise(r => setTimeout(r, 800));
        if (!adminGateIsScanning) break;
        if (video.readyState !== video.HAVE_ENOUGH_DATA) continue;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            const processed = preprocessAdminPlate(canvas);
            const tRes = await adminTesseractWorker.recognize(processed);
            const cleanText = normaliseAdminOCR(tRes.data.text);

            if (cleanText.length >= 4) {
                overlay.textContent = cleanText;
                overlay.style.display = 'block';
                statusMsg.textContent = `Processing Plate: ${cleanText}...`;

                // 1. Check for EXIT FIRST (if plate is already parked)
                let matchedVisitor = null;
                try {
                    const visRes = await fetch('/api/visitors');
                    const visitors = await visRes.json();
                    matchedVisitor = (visitors || []).find(v => !v.exitTime && adminFuzzyMatch(normaliseAdminOCR(v.licensePlate), cleanText));
                } catch (e) { }

                if (matchedVisitor) {
                    statusMsg.textContent = `✅ Plate matched! Calculating exit charges...`;

                    const savedRate = localStorage.getItem('smartpark_rate_per_hour') || 5;
                    const entryMs = new Date(matchedVisitor.entryTime).getTime();
                    const diffHrs = (Date.now() - entryMs) / 3600000;
                    const FINE_AMOUNT = getFineAmount();
                    const totalCharge = (Math.max(diffHrs * parseFloat(savedRate), 0)) + (Date.now() - entryMs > (matchedVisitor.estimatedHours || 4) * 3600000 ? FINE_AMOUNT : 0);

                    await fetch('/api/visitors/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: matchedVisitor.id,
                            exitTime: new Date().toISOString(),
                            totalCharge: totalCharge
                        })
                    });

                    statusMsg.textContent = `🚗 Vehicle exit processed: ${cleanText}`;
                    exitPlateText.textContent = `Plate: ${cleanText}`;
                    exitChargeText.textContent = `Charge: ₹${totalCharge.toFixed(2)}`;
                    exitWrap.style.display = 'block';

                    setTimeout(() => {
                        exitWrap.style.display = 'none';
                        overlay.style.display = 'none';
                        statusMsg.textContent = `Resuming scan...`;
                        startDashboardScan();
                    }, 6000);
                    break;
                }

                // 2. Check for ENTRY (if plate is in approved visitor requests)
                let matchedRequest = null;
                try {
                    const reqRes = await fetch('/api/visitor-requests');
                    const requests = await reqRes.json();
                    matchedRequest = (requests || []).find(r => r.status === 'approved' && adminFuzzyMatch(normaliseAdminOCR(r.licensePlate), cleanText));
                } catch (e) { }

                if (matchedRequest) {
                    statusMsg.textContent = `✅ Plate matched! Triggering admin notification...`;
                    entryText.textContent = `${matchedRequest.visitorName} visiting ${matchedRequest.visitingFlatId}`;

                    // Trigger gate notification immediately when plate is validated
                    const triggerRes = await fetch('/api/gate-notifications/trigger', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: matchedRequest.id,
                            visitorName: matchedRequest.visitorName,
                            licensePlate: matchedRequest.licensePlate,
                            isManual: false
                        })
                    });
                    const triggerData = await triggerRes.json();

                    if (triggerData.success) {
                        statusMsg.textContent = `✅ Notification sent to admin!`;
                        entryWrap.style.display = 'block';

                        entryBtn.onclick = async () => {
                            // Dismiss the notification to open the gate
                            await fetch('/api/gate-notifications/dismiss', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: triggerData.notificationId })
                            });

                            // Also add visitor to the visitors table with entry time
                            const entryRes = await fetch('/api/visitors', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    id: Date.now().toString(),
                                    name: matchedRequest.visitorName,
                                    phone: matchedRequest.visitorPhone,
                                    licensePlate: matchedRequest.licensePlate,
                                    visitingFlat: matchedRequest.visitingFlatId,
                                    entryTime: new Date().toISOString()
                                })
                            });

                            entryWrap.style.display = 'none';
                            overlay.style.display = 'none';
                            statusMsg.textContent = `🔓 Gate opened for ${cleanText}. Entry recorded!`;
                            adminGateIsScanning = false;
                            setTimeout(startDashboardScan, 3000);
                        };
                    } else {
                        statusMsg.textContent = `⚠️ Failed to notify admin: ${triggerData.message || 'Unknown error'}`;
                        setTimeout(startDashboardScan, 3000);
                    }
                    break;
                }
            } else {
                overlay.style.display = 'none';
                statusMsg.textContent = "Scanning for plates...";
            }
        } catch (err) { console.warn(err); }
    }
}

function stopAdminCamera() {
    Object.keys(_activeStreams).forEach(key => {
        if (_activeStreams[key]) {
            _activeStreams[key].getTracks().forEach(t => t.stop());
            delete _activeStreams[key];
        }
    });
    adminGateIsScanning = false;
}

// Gate Control Monitors (CCTV)
async function startGateMonitors() {
    const gateCctvVid = document.getElementById('gate-cctv-video');
    const dashCctvVid = document.getElementById('dash-cctv-video');
    const gateStatus = document.getElementById('gate-cctv-status');
    const dashStatus = document.getElementById('dash-cctv-status');


    if (!_activeStreams['monitor'] && (gateCctvVid || dashCctvVid)) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            _activeStreams['monitor'] = stream;
            if (gateCctvVid) gateCctvVid.srcObject = stream;
            if (dashCctvVid) dashCctvVid.srcObject = stream;

            if (gateStatus) gateStatus.textContent = "Live Gate Stream";
            if (dashStatus) dashStatus.textContent = "Live";
        } catch (e) {
            if (gateStatus) gateStatus.textContent = "Camera Error";
            if (dashStatus) dashStatus.textContent = "Error";
        }
    } else if (_activeStreams['monitor']) {
        if (gateCctvVid) gateCctvVid.srcObject = _activeStreams['monitor'];
        if (dashCctvVid) dashCctvVid.srcObject = _activeStreams['monitor'];
    }

    // Start Exit feed

}

// (Camera remains running in the background when changing tabs)

async function adminGateContinuousScan() {
    const video = document.getElementById('gate-camera-feed');
    const canvas = document.getElementById('gate-snapshot-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const statusMsg = document.getElementById('gate-camera-status');
    const overlay = document.getElementById('detected-plate-admin-gate');

    const entryWrap = document.getElementById('gate-match-entry-result');
    const entryText = document.getElementById('gate-match-entry-text');
    const entryBtn = document.getElementById('btn-gate-open-entry');

    const exitWrap = document.getElementById('gate-match-exit-result');
    const exitPlateText = document.getElementById('gate-match-exit-plate');
    const exitChargeText = document.getElementById('gate-match-exit-charge');

    if (!adminTesseractWorker) {
        statusMsg.textContent = "OCR engine missing or loading...";
        setTimeout(adminGateContinuousScan, 2000);
        return;
    }

    adminGateIsScanning = true;
    statusMsg.textContent = "Auto-monitoring entrance & exit...";

    while (adminGateIsScanning) {
        await new Promise(r => setTimeout(r, 800));
        if (!adminGateIsScanning) break;
        if (video.readyState !== video.HAVE_ENOUGH_DATA) continue;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            const processed = preprocessAdminPlate(canvas);
            const tRes = await adminTesseractWorker.recognize(processed);
            const cleanText = normaliseAdminOCR(tRes.data.text);

            if (cleanText.length >= 4) {
                overlay.textContent = cleanText;
                overlay.style.display = 'block';
                statusMsg.textContent = `Scanning plate: ${cleanText}...`;

                // 1. Check for ENTRY
                let matchedRequest = null;
                try {
                    const reqRes = await fetch('/api/visitor-requests');
                    const requests = await reqRes.json();
                    matchedRequest = (requests || []).find(r => r.status === 'approved' && adminFuzzyMatch(normaliseAdminOCR(r.licensePlate), cleanText));
                } catch (e) { }

                if (matchedRequest) {
                    statusMsg.textContent = `✅ Plate matched! Triggering admin notification...`;
                    entryText.textContent = `${matchedRequest.visitorName} visiting ${matchedRequest.visitingFlatId}`;

                    // Trigger gate notification immediately when plate is validated
                    const triggerRes = await fetch('/api/gate-notifications/trigger', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: matchedRequest.id,
                            visitorName: matchedRequest.visitorName,
                            licensePlate: matchedRequest.licensePlate,
                            isManual: false
                        })
                    });
                    const triggerData = await triggerRes.json();

                    if (triggerData.success) {
                        statusMsg.textContent = `✅ Notification sent to admin!`;
                        entryWrap.style.display = 'block';

                        entryBtn.onclick = async () => {
                            // Dismiss the notification to open the gate
                            await fetch('/api/gate-notifications/dismiss', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: triggerData.notificationId })
                            });

                            // Also add visitor to the visitors table with entry time
                            const entryRes = await fetch('/api/visitors', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    id: Date.now().toString(),
                                    name: matchedRequest.visitorName,
                                    phone: matchedRequest.visitorPhone,
                                    licensePlate: matchedRequest.licensePlate,
                                    visitingFlat: matchedRequest.visitingFlatId,
                                    entryTime: new Date().toISOString()
                                })
                            });

                            entryWrap.style.display = 'none';
                            overlay.style.display = 'none';
                            statusMsg.textContent = `🔓 Gate opened for ${cleanText}. Entry recorded!`;
                            adminGateIsScanning = false;
                            setTimeout(adminGateContinuousScan, 3000);
                        };
                    } else {
                        statusMsg.textContent = `⚠️ Failed to notify admin: ${triggerData.message || 'Unknown error'}`;
                        setTimeout(adminGateContinuousScan, 3000);
                    }
                    break;
                }

                // 2. Check for EXIT
                let matchedVisitor = null;
                try {
                    const visRes = await fetch('/api/visitors');
                    const visitors = await visRes.json();
                    matchedVisitor = (visitors || []).find(v => !v.exitTime && adminFuzzyMatch(normaliseAdminOCR(v.licensePlate), cleanText));
                } catch (e) { }

                if (matchedVisitor) {
                    adminGateIsScanning = false;
                    statusMsg.textContent = `✅ Plate matched! Calculating exit charges...`;

                    const savedRate = localStorage.getItem('smartpark_rate_per_hour') || 5;
                    const entryMs = new Date(matchedVisitor.entryTime).getTime();
                    const diffHrs = (Date.now() - entryMs) / 3600000;
                    const FINE_AMOUNT = getFineAmount();
                    const totalCharge = (Math.max(diffHrs * parseFloat(savedRate), 0)) + (Date.now() - entryMs > (matchedVisitor.estimatedHours || 4) * 3600000 ? FINE_AMOUNT : 0);

                    await fetch('/api/visitors/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: matchedVisitor.id,
                            exitTime: new Date().toISOString(),
                            totalCharge: totalCharge
                        })
                    });

                    statusMsg.textContent = `🚗 Vehicle exit processed: ${cleanText}`;
                    exitPlateText.textContent = `Plate: ${cleanText}`;
                    exitChargeText.textContent = `Charge: ₹${totalCharge.toFixed(2)}`;
                    exitWrap.style.display = 'block';

                    setTimeout(() => {
                        exitWrap.style.display = 'none';
                        overlay.style.display = 'none';
                        statusMsg.textContent = `Resuming...`;
                        adminGateContinuousScan();
                    }, 6000);
                    break;
                }
            } else {
                overlay.style.display = 'none';
                statusMsg.textContent = "Auto-monitoring entrance & exit...";
            }
        } catch (err) { console.warn(err); }
    }
}

// ============================================
// SETTINGS EDITING
// ============================================
