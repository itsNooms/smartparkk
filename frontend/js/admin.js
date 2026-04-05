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

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = document.getElementById('username').value.trim();
        const pass = document.getElementById('password').value;

        const btn = loginForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Logging in...';

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();

            if (data.success) {
                sessionStorage.setItem('smartpark_admin_auth', 'true');
                sessionStorage.setItem('smartpark_admin_time', Date.now().toString());
                showDashboard();
            } else {
                loginError.textContent = data.message || 'Invalid username or password.';
                loginError.style.display = 'block';

                // Shake animation for error
                const card = loginForm.closest('.login-card');
                card.style.transform = 'translate(-5px, 0)';
                setTimeout(() => card.style.transform = 'translate(5px, 0)', 50);
                setTimeout(() => card.style.transform = 'translate(-5px, 0)', 100);
                setTimeout(() => card.style.transform = 'translate(5px, 0)', 150);
                setTimeout(() => card.style.transform = 'translate(0, 0)', 200);
            }
        } catch (err) {
            alert('Server not reachable. Make sure backend is running.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Login to Dashboard';
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



    // Password Toggle Logic
    function setupPasswordToggle(inputId, toggleId) {
        const input = document.getElementById(inputId);
        const toggle = document.getElementById(toggleId);
        if (!input || !toggle) return;

        toggle.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent focus loss or form issues
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            toggle.textContent = isPassword ? '🙈' : '👁️';
            toggle.title = isPassword ? 'Hide password' : 'Show password';

            if (!isPassword) input.classList.remove('password-visible');
            else input.classList.add('password-visible');
        });
    }

    setupPasswordToggle('password', 'password-toggle');
    setupPasswordToggle('new-password', 'new-password-toggle');
    setupPasswordToggle('confirm-password', 'confirm-password-toggle');


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
        startDashboardCamera(); // Start camera + scan on dashboard
        refreshInterval = setInterval(() => {
            loadTableData();
            loadResidentsData();
            pollGateNotifications();
        }, 3000);



        // Tab Navigation
        const tabDashboard = document.getElementById('tab-dashboard');
        const tabResidents = document.getElementById('tab-residents');
        const tabHistory = document.getElementById('tab-history');
        const tabParkingLot = document.getElementById('tab-parking-lot');
        const tabBlocked = document.getElementById('tab-blocked');

        const viewDashboard = document.getElementById('dashboard-view');
        const viewResidents = document.getElementById('residents-view');
        const viewHistory = document.getElementById('history-view');
        const viewParkingLot = document.getElementById('parking-lot-view');
        const viewBlocked = document.getElementById('blocked-view');

        const allTabs = [tabDashboard, tabResidents, tabHistory, tabParkingLot, tabBlocked];
        const allViews = [viewDashboard, viewResidents, viewHistory, viewParkingLot, viewBlocked];

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
        // Resident entries always have id starting with 'RES-' (set at scan time)
        // Also catch legacy rows where visitingFlat was stored as 'RESIDENT'
        const isResidentEntry = String(entry.id || '').startsWith('RES-') || entry.visitingFlat === 'RESIDENT';
        const charge = isResidentEntry
                ? `<span style="color:#38bdf8; font-weight:700; font-size:12px; background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.25); padding:3px 8px; border-radius:6px;">🏠 Resident</span>`
                : entry.totalCharge ? `₹${entry.totalCharge.toFixed(2)}` : (isCompleted ? '₹0.00' : 'Accruing...');

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

            // ── AUTO-PROCESS approved entries ─────────────────────────────
            // When a resident approves: automatically add the visitor entry
            // and dismiss the gate notification — no admin click needed.
            if (!notif.type || notif.type === 'approved') {
                autoProcessApprovedEntry(notif);
                return; // skip building a card for approved type
            }
            // ── End auto-process ──────────────────────────────────────────

            // Play alert sound for denied/blocked alerts
            playGateAlert();

            // Build the card for denied / blocked notifications
            const card = document.createElement('div');
            card.className = 'gate-alert';
            card.id = `gate-alert-${notifIdStr}`;

            const timeStr = new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let title = '❌ REQUEST DENIED';
            let subtitle = `Resident rejected entry · ${timeStr}`;
            let icon = '🚫';
            let actionHtml = `
                <button class="gate-dismiss-btn" style="width:100%; height: 36px; display: flex; align-items: center; justify-content: center; font-weight: 600;" onclick="dismissGateAlert('${notif.id}', this)">
                    Dismiss Alert
                </button>
            `;

            if (notif.type === 'blocked') {
                title = '🛑 VISITOR BLOCKED';
                subtitle = `Resident blocked this visitor · ${timeStr}`;
                icon = '⛔';
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

            // ── Auto-dismiss denied/blocked after 8 seconds ───────────────
            const progressBar = document.createElement('div');
            progressBar.style.cssText = `
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                width: 100%;
                border-radius: 0 0 16px 16px;
                background: rgba(255,255,255,0.18);
                overflow: hidden;
            `;
            const progressFill = document.createElement('div');
            progressFill.style.cssText = `
                height: 100%;
                width: 100%;
                border-radius: inherit;
                background: rgba(255,255,255,0.5);
                transform-origin: left;
                animation: gateProgressBar 8s linear forwards;
            `;
            progressBar.appendChild(progressFill);
            card.style.position = 'relative';
            card.style.overflow = 'hidden';
            card.appendChild(progressBar);

            if (!document.getElementById('gate-progress-style')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'gate-progress-style';
                styleEl.textContent = `
                    @keyframes gateProgressBar {
                        from { transform: scaleX(1); }
                        to   { transform: scaleX(0); }
                    }
                `;
                document.head.appendChild(styleEl);
            }

            setTimeout(() => {
                dismissGateAlert(notif.id, null);
            }, 8000);
            // ── End auto-dismiss ──────────────────────────────────────────

        });

        const validNotifs = (notifications || []).filter(n => !_processedGateNotifs.has(String(n.id)));
        const activeNotifCount = validNotifs.length;
        updateGateBadge(activeNotifCount);

    } catch (err) {
        // Silently fail — don't spam console on network hiccups
    } finally {
        _isPollingGateNotifs = false;
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

// ============================================
// AUTO-PROCESS APPROVED VISITOR ENTRIES
// ============================================
// Called when a gate notification of type 'approved' is detected.
// Automatically adds the visitor entry record AND dismisses the notification
// so the gate opens without the admin having to click anything.
async function autoProcessApprovedEntry(notif) {
    const idStr = String(notif.id);
    console.log(`[AUTO-GATE] Auto-processing approved entry for ${notif.visitorName} (${notif.licensePlate})`);

    try {
        // 1. Add a visitor entry record
        const savedRate = parseFloat(localStorage.getItem('smartpark_rate_per_hour') || '5');
        const visitorPayload = {
            id: notif.requestId || ('AUTO-' + idStr),
            name: notif.visitorName,
            phone: notif.visitorPhone || '',
            licensePlate: notif.licensePlate,
            visitingFlat: notif.visitingFlat,
            entryTime: new Date().toISOString(),
            exitTime: null,
            ratePerHour: savedRate,
            totalCharge: 0,
            estimatedHours: 4
        };

        const entryRes = await fetch('/api/visitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(visitorPayload)
        });
        const entryData = await entryRes.json();
        if (!entryData.success) {
            // Vehicle may already be parked (duplicate) — still proceed to dismiss
            console.warn('[AUTO-GATE] Visitor entry warning:', entryData.message);
        }

        // 2. Dismiss / open the gate notification on the server
        const dismissRes = await fetch('/api/gate-notifications/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notif.id })
        });
        const dismissData = await dismissRes.json();

        if (dismissData.success) {
            _processedGateNotifs.add(idStr);
            _shownGateNotifs.delete(idStr);
            saveNotifState();
            console.log(`[AUTO-GATE] ✅ Gate auto-opened & visitor entry saved for ${notif.visitorName}`);
            // Refresh table to show the new entry
            loadTableData();
        } else {
            console.error('[AUTO-GATE] Dismiss failed:', dismissData.message);
        }
    } catch (err) {
        console.error('[AUTO-GATE] Error:', err);
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
    // Exclude RESIDENT entries — residents use their own reserved spots, not the numbered visitor lot
    let activeVisitors = [];
    try {
        const res = await fetch('/api/visitors');
        const all = await res.json();
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        activeVisitors = (all || []).filter(v => {
            if (v.exitTime) return false;
            // Exclude resident entries from visitor parking spots
            // Resident entries have id starting with 'RES-', or legacy visitingFlat='RESIDENT'
            if (String(v.id || '').startsWith('RES-') || v.visitingFlat === 'RESIDENT') return false;
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
                overlay.textContent = "Validating...";
                overlay.style.display = 'block';
                statusMsg.textContent = "Validating...";

                // 1. Check for EXIT FIRST (if plate is already parked)
                let matchedVisitor = null;
                try {
                    const visRes = await fetch('/api/visitors');
                    const visitors = await visRes.json();
                    matchedVisitor = (visitors || []).find(v => !v.exitTime && adminFuzzyMatch(normaliseAdminOCR(v.licensePlate || ''), cleanText));
                } catch (e) { }

                if (matchedVisitor) {
                    statusMsg.textContent = "✅ Validated! Processing exit fees...";
                    const savedRate = localStorage.getItem('smartpark_rate_per_hour') || 5;
                    const entryMs = new Date(matchedVisitor.entryTime).getTime();
                    const diffMs = Math.max(Date.now() - entryMs, 0);
                    const diffHrs = diffMs / 3600000;
                    const totalCharge = (diffHrs * parseFloat(savedRate)) + (diffMs > (matchedVisitor.estimatedHours || 4) * 3600000 ? getFineAmount() : 0);

                    await fetch('/api/visitors/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: matchedVisitor.id, exitTime: new Date().toISOString(), totalCharge: totalCharge })
                    });

                    statusMsg.textContent = `🚗 Vehicle exit processed (Charge: ₹${totalCharge.toFixed(2)})`;
                    setTimeout(() => {
                        overlay.style.display = 'none';
                        startDashboardScan();
                    }, 6000);
                    break;
                }

                // 1b. Check if plate belongs to a RESIDENT (free entry/exit)
                let matchedResident = null;
                try {
                    const resRes = await fetch('/api/residents');
                    const residents = await resRes.json();
                    matchedResident = (residents || []).find(r => {
                        if (!r.carPlate || r.carPlate === 'N/A') return false;
                        // Support multiple plates stored as comma-separated
                        return r.carPlate.split(',').some(p =>
                            adminFuzzyMatch(normaliseAdminOCR(p.trim()), cleanText)
                        );
                    });
                } catch (e) { }

                if (matchedResident) {
                    // Check if this resident vehicle already has an active entry (= exit scan)
                    let activeResidentEntry = null;
                    try {
                        const visRes2 = await fetch('/api/visitors');
                        const visitors2 = await visRes2.json();
                        activeResidentEntry = (visitors2 || []).find(v =>
                            !v.exitTime &&
                            // Resident entries have id starting with 'RES-', or legacy visitingFlat='RESIDENT'
                            (String(v.id || '').startsWith('RES-') || v.visitingFlat === 'RESIDENT') &&
                            adminFuzzyMatch(normaliseAdminOCR(v.licensePlate || ''), cleanText)
                        );
                    } catch (e) { }

                    if (activeResidentEntry) {
                        // EXIT — close their entry at zero cost
                        await fetch('/api/visitors/update', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: activeResidentEntry.id, exitTime: new Date().toISOString(), totalCharge: 0 })
                        });
                        overlay.textContent = matchedResident.carPlate;
                        statusMsg.textContent = `🏠 Resident exit logged — ${matchedResident.name} (${matchedResident.flatInput}). No charge.`;
                    } else {
                        // ENTRY — create a free log entry
                        const resEntryId = 'RES-' + Date.now();
                        await fetch('/api/visitors', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: resEntryId,
                                name: matchedResident.name,
                                phone: matchedResident.phone,
                                licensePlate: matchedResident.carPlate.split(',')[0].trim(),
                                visitingFlat: matchedResident.flatInput,
                                entryTime: new Date().toISOString(),
                                exitTime: null,
                                ratePerHour: 0,
                                totalCharge: 0,
                                estimatedHours: 12
                            })
                        });
                        overlay.textContent = matchedResident.carPlate;
                        statusMsg.textContent = `🏠 Resident entry logged — ${matchedResident.name} (${matchedResident.flatInput}). No charge.`;
                    }

                    setTimeout(() => {
                        overlay.style.display = 'none';
                        startDashboardScan();
                    }, 5000);
                    break;
                }

                // 2. Check for ENTRY
                let matchedRequest = null;
                try {
                    const reqRes = await fetch('/api/visitor-requests');
                    const requests = await reqRes.json();
                    matchedRequest = (requests || []).find(r => r.status === 'approved' && adminFuzzyMatch(normaliseAdminOCR(r.licensePlate || ''), cleanText));
                } catch (e) { }

                if (matchedRequest) {
                    statusMsg.textContent = "✅ Validated! Sending notification...";
                    const triggerRes = await fetch('/api/gate-notifications/trigger', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: matchedRequest.id,
                            visitorName: matchedRequest.visitorName,
                            licensePlate: matchedRequest.licensePlate,
                            visitingFlat: matchedRequest.visitingFlat,
                            visitorPhone: matchedRequest.visitorPhone
                        })
                    });
                    const triggerData = await triggerRes.json();
                    if (triggerData.success) {
                        statusMsg.textContent = `✅ Notification sent! Use floating alert to open gate.`;
                        setTimeout(() => {
                            overlay.style.display = 'none';
                            startDashboardScan();
                        }, 4000);
                    } else {
                        statusMsg.textContent = `⚠️ Failed: ${triggerData.message || 'Error'}`;
                        setTimeout(startDashboardScan, 3000);
                    }
                    break;
                }
            } else {
                overlay.style.display = 'none';
                statusMsg.textContent = "Scanning for plates...";
            }
        } catch (err) { console.warn('[OCR Error]', err); }
    }
}





// ============================================
// SETTINGS EDITING
// ============================================