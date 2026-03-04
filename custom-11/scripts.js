/* ============================================================
   CASHFLOW COMMAND - SCRIPTS
   Frontend logic for the CashFlow Command dashboard
   ============================================================ */

(() => {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================
    const CONFIG = {
        apiBase: 'https://budget.jonathan-castro.com/api',
        apiKey: 'b9693abf4cce2ec4de4caf6c6aa8849a6ad00cb2824c47e0630d62deb93d5e49',
        txnPerPage: 20,
        chartColors: [
            '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
            '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
            '#14b8a6', '#e11d48', '#a855f7', '#22c55e', '#eab308'
        ]
    };

    // ============================================================
    // STATE
    // ============================================================
    let state = {
        accounts: [],
        transactions: [],
        budgets: [],
        goals: [],
        syncStatus: null,
        currentPage: 1,
        searchQuery: '',
        categoryFilter: '',
        selectedMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
        charts: { donut: null, trend: null }
    };

    // ============================================================
    // HELPERS
    // ============================================================
    function $(selector) {
        return document.querySelector(selector);
    }

    function $$(selector) {
        return document.querySelectorAll(selector);
    }

    function formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2
        }).format(amount);
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function friendlyCategory(cat) {
        if (!cat) return 'Uncategorized';
        // Convert PLAID_CATEGORY_FORMAT to Title Case
        return cat
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    function showToast(message, type = 'info') {
        const container = $('#toastContainer');
        const toast = document.createElement('div');
        toast.className = `cf-toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            toast.style.transition = '0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ============================================================
    // API LAYER
    // ============================================================
    async function apiCall(endpoint, options = {}) {
        const url = `${CONFIG.apiBase}${endpoint}`;
        const headers = {
            'X-API-Key': CONFIG.apiKey,
            'Content-Type': 'application/json',
            ...options.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.message || `HTTP ${response.status}`);
            }

            return data;
        } catch (err) {
            console.error(`API Error [${endpoint}]:`, err);
            throw err;
        }
    }

    // ============================================================
    // PLAID LINK
    // ============================================================
    async function initPlaidLink() {
        try {
            const { link_token } = await apiCall('/plaid/create-link-token', {
                method: 'POST'
            });

            const handler = Plaid.create({
                token: link_token,
                onSuccess: async (publicToken, metadata) => {
                    showToast('Connecting your account...', 'info');
                    try {
                        const result = await apiCall('/plaid/exchange-token', {
                            method: 'POST',
                            body: JSON.stringify({
                                public_token: publicToken,
                                institution_name: metadata.institution?.name || 'Unknown'
                            })
                        });
                        showToast(result.message || 'Account linked!', 'success');
                        // Refresh everything
                        await loadDashboard();
                    } catch (err) {
                        showToast('Failed to link account: ' + err.message, 'error');
                    }
                },
                onExit: (err) => {
                    if (err) {
                        console.warn('Plaid Link exited with error:', err);
                    }
                },
                onEvent: (eventName) => {
                    console.log('Plaid event:', eventName);
                }
            });

            handler.open();
        } catch (err) {
            showToast('Failed to start bank connection: ' + err.message, 'error');
        }
    }

    // ============================================================
    // DATA LOADING
    // ============================================================
    async function loadAccounts() {
        try {
            state.accounts = await apiCall('/accounts');
            return state.accounts;
        } catch (err) {
            console.error('Failed to load accounts:', err);
            state.accounts = [];
            return [];
        }
    }

    async function loadTransactions() {
        try {
            // The backend might not have /api/transactions yet.
            // If it doesn't exist, we'll handle gracefully.
            state.transactions = await apiCall('/transactions');
            return state.transactions;
        } catch (err) {
            console.warn('Transactions endpoint not available yet:', err.message);
            state.transactions = [];
            return [];
        }
    }

    async function loadBudgets() {
        try {
            state.budgets = await apiCall('/budgets');
            return state.budgets;
        } catch (err) {
            console.warn('Budgets endpoint not available yet:', err.message);
            state.budgets = [];
            return [];
        }
    }

    async function loadGoals() {
        try {
            state.goals = await apiCall('/goals');
            return state.goals;
        } catch (err) {
            console.warn('Goals endpoint not available yet:', err.message);
            state.goals = [];
            return [];
        }
    }

    async function loadSyncStatus() {
        try {
            state.syncStatus = await apiCall('/sync-status');
            return state.syncStatus;
        } catch (err) {
            console.warn('Sync status not available:', err.message);
            return null;
        }
    }

    async function triggerSync() {
        const syncBtn = $('#syncBtn');
        if (syncBtn) {
            syncBtn.classList.add('loading');
            syncBtn.querySelector('span').textContent = 'Syncing...';
        }

        try {
            const result = await apiCall('/plaid/sync', { method: 'POST' });
            showToast(
                `Synced! +${result.transactions_added} new, ${result.transactions_modified} updated.`,
                'success'
            );
            await loadDashboard();
        } catch (err) {
            showToast('Sync failed: ' + err.message, 'error');
        } finally {
            if (syncBtn) {
                syncBtn.classList.remove('loading');
                syncBtn.querySelector('span').textContent = 'Sync Now';
            }
        }
    }

    // ============================================================
    // HEALTH CHECK & STATUS
    // ============================================================
    async function checkHealth() {
        const pill = $('#statusPill');
        const text = $('#statusText');

        try {
            const health = await fetch(`${CONFIG.apiBase}/health`).then(r => r.json());

            if (health.status === 'healthy') {
                pill.className = 'cf-status-pill online';
                text.textContent = `Online · ${health.plaid_env}`;
                return health;
            } else {
                pill.className = 'cf-status-pill offline';
                text.textContent = 'Unhealthy';
                return null;
            }
        } catch (err) {
            pill.className = 'cf-status-pill offline';
            text.textContent = 'Offline';
            return null;
        }
    }

    function updateSyncDisplay() {
        const el = $('#lastSyncDisplay');
        if (state.syncStatus && state.syncStatus.synced_at) {
            const d = new Date(state.syncStatus.synced_at);
            el.textContent = `Last sync: ${d.toLocaleString()}`;
        } else if (state.syncStatus && state.syncStatus.message) {
            el.textContent = 'Last sync: Never';
        }
    }

    // ============================================================
    // RENDER: ACCOUNTS
    // ============================================================
    function renderAccounts() {
        const row = $('#accountsRow');
        if (!state.accounts.length) {
            row.innerHTML = '';
            return;
        }

        row.innerHTML = state.accounts.map(acct => {
            const typeClass = (acct.type || '').toLowerCase();
            let iconName = 'wallet';
            if (typeClass === 'credit') iconName = 'credit-card';
            else if (acct.subtype === 'savings') iconName = 'piggy-bank';
            else if (typeClass === 'depository') iconName = 'landmark';

            return `
                <div class="cf-account-card">
                    <div class="cf-acct-header">
                        <div class="cf-acct-icon ${acct.subtype || typeClass}">
                            <i data-lucide="${iconName}"></i>
                        </div>
                        <div>
                            <div class="cf-acct-name">${acct.name || 'Account'}</div>
                            <div class="cf-acct-type">${acct.institution_name || ''} · ${acct.subtype || acct.type || ''}</div>
                        </div>
                    </div>
                    <div class="cf-acct-balance">${formatCurrency(acct.current_balance || 0)}</div>
                    <div class="cf-acct-available">Available: ${formatCurrency(acct.available_balance || 0)}</div>
                </div>
            `;
        }).join('');

        // Re-create Lucide icons in new DOM
        if (window.lucide) lucide.createIcons();
    }

    // ============================================================
    // RENDER: NET WORTH
    // ============================================================
    function renderNetWorth() {
        let assets = 0;
        let liabilities = 0;

        state.accounts.forEach(acct => {
            const bal = acct.current_balance || 0;
            const type = (acct.type || '').toLowerCase();
            if (type === 'credit' || type === 'loan') {
                liabilities += Math.abs(bal);
            } else {
                assets += bal;
            }
        });

        const netWorth = assets - liabilities;

        $('#networthValue').textContent = formatCurrency(netWorth);
        const breakdown = $('#networthBreakdown');
        breakdown.querySelector('.cf-nw-assets').textContent = `Assets: ${formatCurrency(assets)}`;
        breakdown.querySelector('.cf-nw-liabilities').textContent = `Liabilities: ${formatCurrency(liabilities)}`;
    }

    // ============================================================
    // RENDER: MONTHLY SNAPSHOT
    // ============================================================
    function renderSnapshot() {
        const month = state.selectedMonth;
        const monthTxns = state.transactions.filter(t => t.date && t.date.startsWith(month));

        let income = 0;
        let spending = 0;

        monthTxns.forEach(t => {
            const amt = t.amount || 0;
            // Plaid convention: positive = expense, negative = income
            if (amt < 0) {
                income += Math.abs(amt);
            } else {
                spending += amt;
            }
        });

        const net = income - spending;

        $('#snapIncome').textContent = formatCurrency(income);
        $('#snapSpending').textContent = formatCurrency(spending);

        const netEl = $('#snapNet');
        netEl.textContent = formatCurrency(net);
        netEl.style.color = net >= 0 ? 'var(--cf-income)' : 'var(--cf-expense)';
    }

    // ============================================================
    // RENDER: CHARTS
    // ============================================================
    function renderCategoryDonut() {
        const month = state.selectedMonth;
        const monthTxns = state.transactions.filter(
            t => t.date && t.date.startsWith(month) && (t.amount || 0) > 0
        );

        // Group by category
        const categoryMap = {};
        monthTxns.forEach(t => {
            const cat = friendlyCategory(t.custom_category || t.plaid_category);
            categoryMap[cat] = (categoryMap[cat] || 0) + (t.amount || 0);
        });

        const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
        const labels = sorted.map(s => s[0]);
        const values = sorted.map(s => s[1]);

        // Destroy old chart
        if (state.charts.donut) state.charts.donut.destroy();

        const ctx = $('#categoryDonut');
        if (!ctx || !labels.length) {
            // No data — show empty state
            const legend = $('#categoryLegend');
            if (legend) legend.innerHTML = '<span class="cf-empty-state">No spending data for this month.</span>';
            return;
        }

        state.charts.donut = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: CONFIG.chartColors.slice(0, labels.length),
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1a2236',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(16, 185, 129, 0.25)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                const total = values.reduce((a, b) => a + b, 0);
                                const pct = ((context.raw / total) * 100).toFixed(1);
                                return ` ${formatCurrency(context.raw)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });

        // Custom legend
        const legend = $('#categoryLegend');
        legend.innerHTML = sorted.slice(0, 8).map((s, i) => `
            <span class="cf-legend-item">
                <span class="cf-legend-dot" style="background:${CONFIG.chartColors[i]}"></span>
                ${s[0]}: ${formatCurrency(s[1])}
            </span>
        `).join('');
    }

    function renderTrendChart() {
        // Get last 6 months of data
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(d.toISOString().slice(0, 7));
        }

        const incomeData = [];
        const spendingData = [];

        months.forEach(m => {
            const txns = state.transactions.filter(t => t.date && t.date.startsWith(m));
            let inc = 0, exp = 0;
            txns.forEach(t => {
                if ((t.amount || 0) < 0) inc += Math.abs(t.amount);
                else exp += (t.amount || 0);
            });
            incomeData.push(inc);
            spendingData.push(exp);
        });

        const labels = months.map(m => {
            const d = new Date(m + '-01');
            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        });

        if (state.charts.trend) state.charts.trend.destroy();

        const ctx = $('#trendLine');
        if (!ctx) return;

        state.charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#10b981'
                    },
                    {
                        label: 'Spending',
                        data: spendingData,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#ef4444'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148,163,184,0.05)' },
                        ticks: { color: '#64748b', font: { size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(148,163,184,0.05)' },
                        ticks: {
                            color: '#64748b',
                            font: { size: 11 },
                            callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle' }
                    },
                    tooltip: {
                        backgroundColor: '#1a2236',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(148,163,184,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                        }
                    }
                }
            }
        });
    }

    // ============================================================
    // RENDER: TRANSACTIONS TABLE
    // ============================================================
    function renderTransactions() {
        let txns = [...state.transactions];

        // Filter by month
        txns = txns.filter(t => t.date && t.date.startsWith(state.selectedMonth));

        // Filter by search
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            txns = txns.filter(t =>
                (t.name || '').toLowerCase().includes(q) ||
                (t.merchant_name || '').toLowerCase().includes(q) ||
                (t.plaid_category || '').toLowerCase().includes(q)
            );
        }

        // Filter by category
        if (state.categoryFilter) {
            txns = txns.filter(t =>
                (t.custom_category || t.plaid_category || '') === state.categoryFilter
            );
        }

        // Sort by date descending
        txns.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        // Paginate
        const totalPages = Math.ceil(txns.length / CONFIG.txnPerPage) || 1;
        if (state.currentPage > totalPages) state.currentPage = totalPages;
        const start = (state.currentPage - 1) * CONFIG.txnPerPage;
        const pageTxns = txns.slice(start, start + CONFIG.txnPerPage);

        const tbody = $('#txnBody');
        if (!pageTxns.length) {
            tbody.innerHTML = `
                <tr><td colspan="4" class="cf-empty-state">No transactions found.</td></tr>
            `;
        } else {
            tbody.innerHTML = pageTxns.map(t => {
                const amt = t.amount || 0;
                const isIncome = amt < 0;
                const displayAmt = isIncome ? Math.abs(amt) : amt;
                const amtClass = isIncome ? 'cf-txn-amount-pos' : 'cf-txn-amount-neg';
                const sign = isIncome ? '+' : '-';

                return `
                    <tr>
                        <td class="cf-txn-date">${formatDate(t.date)}</td>
                        <td>${t.merchant_name || t.name || 'Unknown'}</td>
                        <td><span class="cf-txn-category">${friendlyCategory(t.custom_category || t.plaid_category)}</span></td>
                        <td class="cf-text-right ${amtClass}">${sign}${formatCurrency(displayAmt)}</td>
                    </tr>
                `;
            }).join('');
        }

        // Pagination
        const pagEl = $('#txnPagination');
        if (totalPages <= 1) {
            pagEl.innerHTML = '';
        } else {
            let btns = '';
            for (let i = 1; i <= totalPages; i++) {
                btns += `<button class="cf-page-btn ${i === state.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            pagEl.innerHTML = btns;
        }

        // Populate category filter dropdown
        populateCategoryFilter();
    }

    function populateCategoryFilter() {
        const select = $('#txnCategoryFilter');
        const categories = new Set();
        state.transactions.forEach(t => {
            const cat = t.custom_category || t.plaid_category;
            if (cat) categories.add(cat);
        });

        const current = select.value;
        select.innerHTML = '<option value="">All Categories</option>' +
            [...categories].sort().map(c => `<option value="${c}">${friendlyCategory(c)}</option>`).join('');
        select.value = current;
    }

    // ============================================================
    // RENDER: BUDGETS
    // ============================================================
    function renderBudgets() {
        const list = $('#budgetList');

        if (!state.budgets.length) {
            list.innerHTML = '<div class="cf-empty-state">No budgets set yet. Click Manage to create one.</div>';
            return;
        }

        // Calculate spending per category for the selected month
        const spending = {};
        state.transactions
            .filter(t => t.date && t.date.startsWith(state.selectedMonth) && (t.amount || 0) > 0)
            .forEach(t => {
                const cat = (t.custom_category || t.plaid_category || '').toLowerCase();
                spending[cat] = (spending[cat] || 0) + (t.amount || 0);
            });

        list.innerHTML = state.budgets.map(b => {
            const spent = spending[b.category.toLowerCase()] || 0;
            const pct = Math.min((spent / b.monthly_limit) * 100, 100);
            let colorClass = 'green';
            if (pct >= 100) colorClass = 'red';
            else if (pct >= (b.alert_threshold || 0.8) * 100) colorClass = 'yellow';

            return `
                <div class="cf-budget-item">
                    <div class="cf-budget-info">
                        <span class="cf-budget-name">${friendlyCategory(b.category)}</span>
                        <span class="cf-budget-amounts">${formatCurrency(spent)} / ${formatCurrency(b.monthly_limit)}</span>
                    </div>
                    <div class="cf-budget-bar-bg">
                        <div class="cf-budget-bar-fill ${colorClass}" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================================
    // RENDER: GOALS
    // ============================================================
    function renderGoals() {
        const grid = $('#goalsGrid');

        if (!state.goals.length) {
            grid.innerHTML = '<div class="cf-empty-state">No goals yet. Start by adding a savings goal!</div>';
            return;
        }

        grid.innerHTML = state.goals.map(g => {
            const pct = Math.min(((g.current_amount || 0) / (g.target_amount || 1)) * 100, 100);
            const circumference = 2 * Math.PI * 50;
            const offset = circumference - (pct / 100) * circumference;

            return `
                <div class="cf-goal-card">
                    <div class="cf-goal-ring-wrap">
                        <svg viewBox="0 0 120 120">
                            <circle class="cf-goal-ring-bg" cx="60" cy="60" r="50"/>
                            <circle class="cf-goal-ring-fill" cx="60" cy="60" r="50"
                                stroke-dasharray="${circumference}"
                                stroke-dashoffset="${offset}"/>
                        </svg>
                        <div class="cf-goal-percent">${Math.round(pct)}%</div>
                    </div>
                    <div class="cf-goal-name">${g.name || 'Goal'}</div>
                    <div class="cf-goal-amounts">
                        ${formatCurrency(g.current_amount || 0)} / ${formatCurrency(g.target_amount || 0)}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================================
    // MONTH SELECTOR
    // ============================================================
    function populateMonthSelector() {
        const select = $('#monthSelector');
        const now = new Date();
        select.innerHTML = '';

        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = d.toISOString().slice(0, 7);
            const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            select.innerHTML += `<option value="${val}" ${val === state.selectedMonth ? 'selected' : ''}>${label}</option>`;
        }
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================
    function openModal(id) {
        const modal = $(`#${id}`);
        if (modal) modal.classList.add('active');
    }

    function closeModal(id) {
        const modal = $(`#${id}`);
        if (modal) modal.classList.remove('active');
    }

    // ============================================================
    // BUDGET CRUD
    // ============================================================
    async function saveBudget() {
        const category = $('#budgetCategory').value.trim();
        const limit = parseFloat($('#budgetLimit').value);

        if (!category || isNaN(limit) || limit <= 0) {
            showToast('Enter a valid category and limit.', 'error');
            return;
        }

        try {
            await apiCall('/budgets', {
                method: 'POST',
                body: JSON.stringify({
                    category,
                    monthly_limit: limit,
                    alert_threshold: 0.8
                })
            });
            showToast(`Budget for "${category}" saved!`, 'success');
            $('#budgetCategory').value = '';
            $('#budgetLimit').value = '';
            await loadBudgets();
            renderBudgets();
            renderBudgetModalList();
        } catch (err) {
            showToast('Failed to save budget: ' + err.message, 'error');
        }
    }

    function renderBudgetModalList() {
        const container = $('#budgetExisting');
        if (!state.budgets.length) {
            container.innerHTML = '<div class="cf-empty-state">No budgets yet.</div>';
            return;
        }

        container.innerHTML = state.budgets.map(b => `
            <div class="cf-budget-existing-item">
                <span>${friendlyCategory(b.category)}: ${formatCurrency(b.monthly_limit)}/mo</span>
                <button class="cf-delete-btn" data-budget-id="${b.id}" title="Delete">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();
    }

    // ============================================================
    // GOAL CRUD
    // ============================================================
    async function saveGoal() {
        const name = $('#goalName').value.trim();
        const target = parseFloat($('#goalTarget').value);
        const current = parseFloat($('#goalCurrent').value) || 0;

        if (!name || isNaN(target) || target <= 0) {
            showToast('Enter a valid goal name and target.', 'error');
            return;
        }

        try {
            await apiCall('/goals', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    target_amount: target,
                    current_amount: current
                })
            });
            showToast(`Goal "${name}" created!`, 'success');
            $('#goalName').value = '';
            $('#goalTarget').value = '';
            $('#goalCurrent').value = '';
            closeModal('goalModal');
            await loadGoals();
            renderGoals();
        } catch (err) {
            showToast('Failed to save goal: ' + err.message, 'error');
        }
    }

    // ============================================================
    // MASTER DASHBOARD LOAD
    // ============================================================
    async function loadDashboard() {
        const health = await checkHealth();

        if (!health) {
            showToast('Backend is offline. Some features unavailable.', 'error');
            return;
        }

        // Load all data in parallel
        await Promise.all([
            loadAccounts(),
            loadTransactions(),
            loadBudgets(),
            loadGoals(),
            loadSyncStatus()
        ]);

        // Decide which view to show
        if (state.accounts.length > 0) {
            $('#connectPanel').style.display = 'none';
            $('#dashboard').style.display = 'block';

            populateMonthSelector();
            renderAccounts();
            renderNetWorth();
            renderSnapshot();
            renderCategoryDonut();
            renderTrendChart();
            renderBudgets();
            renderTransactions();
            renderGoals();
            updateSyncDisplay();
        } else {
            $('#connectPanel').style.display = 'flex';
            $('#dashboard').style.display = 'none';
        }
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================
    function bindEvents() {
        // Link bank button (connect panel)
        const linkBtn = $('#linkBankBtn');
        if (linkBtn) linkBtn.addEventListener('click', initPlaidLink);

        // Add account button (dashboard)
        const addBtn = $('#addAccountBtn');
        if (addBtn) addBtn.addEventListener('click', initPlaidLink);

        // Sync button
        const syncBtn = $('#syncBtn');
        if (syncBtn) syncBtn.addEventListener('click', triggerSync);

        // Month selector
        const monthSel = $('#monthSelector');
        if (monthSel) {
            monthSel.addEventListener('change', (e) => {
                state.selectedMonth = e.target.value;
                state.currentPage = 1;
                renderSnapshot();
                renderCategoryDonut();
                renderTrendChart();
                renderBudgets();
                renderTransactions();
            });
        }

        // Transaction search
        const txnSearch = $('#txnSearch');
        if (txnSearch) {
            txnSearch.addEventListener('input', (e) => {
                state.searchQuery = e.target.value;
                state.currentPage = 1;
                renderTransactions();
            });
        }

        // Transaction category filter
        const txnCatFilter = $('#txnCategoryFilter');
        if (txnCatFilter) {
            txnCatFilter.addEventListener('change', (e) => {
                state.categoryFilter = e.target.value;
                state.currentPage = 1;
                renderTransactions();
            });
        }

        // Pagination (delegated)
        const pagEl = $('#txnPagination');
        if (pagEl) {
            pagEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.cf-page-btn');
                if (btn) {
                    state.currentPage = parseInt(btn.dataset.page);
                    renderTransactions();
                }
            });
        }

        // Budget modal
        const editBudgetBtn = $('#editBudgetBtn');
        if (editBudgetBtn) {
            editBudgetBtn.addEventListener('click', () => {
                renderBudgetModalList();
                openModal('budgetModal');
            });
        }

        const closeBudgetModal = $('#closeBudgetModal');
        if (closeBudgetModal) closeBudgetModal.addEventListener('click', () => closeModal('budgetModal'));

        const saveBudgetBtn = $('#saveBudgetBtn');
        if (saveBudgetBtn) saveBudgetBtn.addEventListener('click', saveBudget);

        // Budget delete (delegated)
        const budgetExisting = $('#budgetExisting');
        if (budgetExisting) {
            budgetExisting.addEventListener('click', async (e) => {
                const btn = e.target.closest('.cf-delete-btn');
                if (btn) {
                    const id = btn.dataset.budgetId;
                    try {
                        await apiCall(`/budgets/${id}`, { method: 'DELETE' });
                        showToast('Budget deleted.', 'success');
                        await loadBudgets();
                        renderBudgets();
                        renderBudgetModalList();
                    } catch (err) {
                        showToast('Failed to delete budget.', 'error');
                    }
                }
            });
        }

        // Goal modal
        const addGoalBtn = $('#addGoalBtn');
        if (addGoalBtn) addGoalBtn.addEventListener('click', () => openModal('goalModal'));

        const closeGoalModal = $('#closeGoalModal');
        if (closeGoalModal) closeGoalModal.addEventListener('click', () => closeModal('goalModal'));

        const saveGoalBtn = $('#saveGoalBtn');
        if (saveGoalBtn) saveGoalBtn.addEventListener('click', saveGoal);

        // Close modals on overlay click
        $$('.cf-modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                }
            });
        });
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================
    async function init() {
        console.log('%c[CashFlow Command]%c Initializing...', 'color:#10b981;font-weight:bold', '');

        // Initialize Lucide icons
        if (window.lucide) lucide.createIcons();

        // Bind events
        bindEvents();

        // Load dashboard
        await loadDashboard();

        console.log('%c[CashFlow Command]%c Ready.', 'color:#10b981;font-weight:bold', '');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
