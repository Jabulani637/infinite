document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements
    const loginScreen = document.getElementById('loginScreen');
    const dashboardContainer = document.getElementById('dashboardContainer');
    const loginForm = document.getElementById('loginForm');
    const adminPasswordInput = document.getElementById('adminPassword');
    const loginError = document.getElementById('loginError');
    const logoutBtn = document.getElementById('nav-logout');
    
    const applicationsTableBody = document.getElementById('applicationsTableBody');
    const tableLoading = document.getElementById('tableLoading');
    const searchInput = document.getElementById('searchInput');
    
    // Stats
    const statPending = document.getElementById('statPending');
    const statApproved = document.getElementById('statApproved');
    const statRejected = document.getElementById('statRejected');
    
    // Modal
    const detailsModal = document.getElementById('detailsModal');
    const closeModalBtn = document.getElementById('closeModal');
    const modalBody = document.getElementById('modalBody');
    const statusSelect = document.getElementById('statusSelect');
    const updateStatusBtn = document.getElementById('updateStatusBtn');
    
    let authToken = localStorage.getItem('adminToken');
    let applicationsData = [];
    let currentSelectedAppId = null;

    // Initialize
    if (authToken) {
        showDashboard();
    }

    // Login Form Handler
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = adminPasswordInput.value;
        
        try {
            const response = await fetch(`${API_BASE_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                authToken = data.token;
                localStorage.setItem('adminToken', authToken);
                loginError.style.display = 'none';
                showDashboard();
            } else {
                loginError.textContent = data.message || 'Login failed';
                loginError.style.display = 'block';
            }
        } catch (error) {
            console.error('Login error:', error);
            loginError.textContent = 'Server error. Please try again.';
            loginError.style.display = 'block';
        }
    });

    // Logout Handler
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('adminToken');
        authToken = null;
        dashboardContainer.style.display = 'none';
        loginScreen.style.display = 'flex';
        adminPasswordInput.value = '';
    });

    function showDashboard() {
        loginScreen.style.display = 'none';
        dashboardContainer.style.display = 'flex';
        fetchApplications();
        loadSettings();
    }

    async function fetchApplications() {
        tableLoading.style.display = 'block';
        try {
            const response = await fetch(`${API_BASE_URL}/admin/applications`, {
                headers: {
                    'Authorization': authToken
                }
            });
            
            if (response.status === 403) {
                // Token invalid
                logoutBtn.click();
                return;
            }
            
            const data = await response.json();
            applicationsData = data;
            renderTable(data);
            updateStats(data);
        } catch (error) {
            console.error('Error fetching applications:', error);
            alert('Failed to load applications.');
        } finally {
            tableLoading.style.display = 'none';
        }
    }

    function renderTable(data) {
        applicationsTableBody.innerHTML = '';
        
        if (data.length === 0) {
            applicationsTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No applications found.</td></tr>';
            return;
        }

        data.forEach(app => {
            const tr = document.createElement('tr');
            
            const date = new Date(app.created_at).toLocaleDateString();
            const statusClass = app.status ? app.status.toLowerCase() : 'pending';
            
            tr.innerHTML = `
                <td>${app.reference_number}</td>
                <td>${app.first_name} ${app.last_name}</td>
                <td>${app.id_number}</td>
                <td>${app.cell_phone}</td>
                <td>${date}</td>
                <td><span class="status-badge ${statusClass}">${app.status || 'Pending'}</span></td>
                <td>
                    <button class="action-btn view-btn" data-id="${app.id}" title="View Details">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    ${app.status !== 'Approved' ? `<button class="action-btn approve-btn" data-id="${app.id}" title="Approve"><i class="fa-solid fa-check-circle"></i></button>` : ''}
                    ${app.status !== 'Rejected' ? `<button class="action-btn reject-btn" data-id="${app.id}" title="Reject"><i class="fa-solid fa-times-circle"></i></button>` : ''}
                </td>
            `;
            applicationsTableBody.appendChild(tr);
        });

        // Add event listeners to view buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appId = e.currentTarget.getAttribute('data-id');
                openDetailsModal(appId);
            });
        });

        // Add event listeners to approve buttons
        document.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appId = e.currentTarget.getAttribute('data-id');
                quickUpdateStatus(appId, 'Approved', e.currentTarget);
            });
        });

        // Add event listeners to reject buttons
        document.querySelectorAll('.reject-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appId = e.currentTarget.getAttribute('data-id');
                quickUpdateStatus(appId, 'Rejected', e.currentTarget);
            });
        });
    }

    async function quickUpdateStatus(id, newStatus, btnElement) {
        const originalHtml = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        btnElement.disabled = true;
        
        try {
            const response = await fetch(`${API_BASE_URL}/admin/update-status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authToken
                },
                body: JSON.stringify({
                    id: id,
                    status: newStatus
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const appIndex = applicationsData.findIndex(a => a.id == id);
                if (appIndex !== -1) {
                    applicationsData[appIndex].status = newStatus;
                }
                
                renderTable(searchInput.value ? applicationsData.filter(app => app.reference_number.toLowerCase().includes(searchInput.value.toLowerCase())) : applicationsData);
                updateStats(applicationsData);
            } else {
                alert('Failed to update status.');
                btnElement.innerHTML = originalHtml;
                btnElement.disabled = false;
            }
        } catch (error) {
            console.error('Error updating status:', error);
            alert('Server error while updating status.');
            btnElement.innerHTML = originalHtml;
            btnElement.disabled = false;
        }
    }

    function updateStats(data) {
        const pending = data.filter(app => !app.status || app.status.toLowerCase() === 'pending').length;
        const approved = data.filter(app => app.status && app.status.toLowerCase() === 'approved').length;
        const rejected = data.filter(app => app.status && app.status.toLowerCase() === 'rejected').length;
        
        statPending.textContent = pending;
        statApproved.textContent = approved;
        statRejected.textContent = rejected;
    }

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = applicationsData.filter(app => {
            return (
                app.reference_number.toLowerCase().includes(term) ||
                app.first_name.toLowerCase().includes(term) ||
                app.last_name.toLowerCase().includes(term) ||
                app.id_number.toLowerCase().includes(term) ||
                app.email.toLowerCase().includes(term)
            );
        });
        renderTable(filtered);
    });

    // Modal Functions
    async function openDetailsModal(id) {
        const app = applicationsData.find(a => a.id == id);
        if (!app) return;
        
        currentSelectedAppId = app.id;
        statusSelect.value = app.status || 'Pending';
        
        const dob = new Date(app.dob).toLocaleDateString();

        // Show modal with a loading state while we fetch signed URLs
        modalBody.innerHTML = `
            <div class="details-grid">
                <div class="detail-section">
                    <h3>Personal Information</h3>
                    <div class="detail-item"><span class="label">Reference Number</span><span class="value">${app.reference_number}</span></div>
                    <div class="detail-item"><span class="label">Full Name</span><span class="value">${app.first_name} ${app.last_name}</span></div>
                    <div class="detail-item"><span class="label">ID Number</span><span class="value">${app.id_number}</span></div>
                    <div class="detail-item"><span class="label">Date of Birth</span><span class="value">${dob}</span></div>
                    <div class="detail-item"><span class="label">Email</span><span class="value">${app.email}</span></div>
                    <div class="detail-item"><span class="label">Cell Phone</span><span class="value">${app.cell_phone}</span></div>
                    <div class="detail-item"><span class="label">POPIA Consent</span><span class="value">${app.popia_consent ? 'Yes' : 'No'}</span></div>
                </div>
                
                <div class="detail-section">
                    <h3>Loan Details &amp; Bank</h3>
                    <div class="detail-item"><span class="label">Amount Requested</span><span class="value" style="color: var(--primary-color);">R ${app.loan_amount || '0.00'}</span></div>
                    <div class="detail-item"><span class="label">Term (Months)</span><span class="value">${app.term_months || '0'}</span></div>
                    <div class="detail-item"><span class="label">Total Expected</span><span class="value">R ${app.total_settlement || '0.00'}</span></div>
                    <div class="detail-item"><span class="label">Game Discount Won</span><span class="value" style="${app.discount_applied ? 'color: var(--success); font-weight: bold;' : ''}">${app.discount_applied ? 'Yes (2%)' : 'No'}</span></div>
                    <div class="detail-item" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;"><span class="label">Purpose of Loan</span><span class="value">${app.purpose}</span></div>
                    <div class="detail-item"><span class="label">Description</span><span class="value">${app.description}</span></div>
                    <div class="detail-item"><span class="label">Bank Name</span><span class="value">${app.bank_name}</span></div>
                    <div class="detail-item"><span class="label">Account Number</span><span class="value">${app.acc_num}</span></div>
                </div>
                
                <div class="detail-section">
                    <h3>Guarantor Information</h3>
                    <div class="detail-item"><span class="label">Name</span><span class="value">${app.guarantor_name}</span></div>
                    <div class="detail-item"><span class="label">ID Number</span><span class="value">${app.guarantor_id}</span></div>
                    <div class="detail-item"><span class="label">Phone</span><span class="value">${app.guarantor_phone}</span></div>
                    <div class="detail-item"><span class="label">Relationship</span><span class="value">${app.guarantor_rel}</span></div>
                </div>

                <div class="detail-section" style="grid-column: 1 / -1;">
                    <h3>Uploaded Documents</h3>
                    <div class="document-gallery" id="docGallery">
                        <p style="color: var(--text-muted); font-size: 0.85rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading documents...</p>
                    </div>
                </div>
            </div>
        `;
        detailsModal.style.display = 'flex';

        // Fetch signed URLs for all documents in parallel
        const docFields = [
            { label: 'ID Document',          path: app.path_id,            icon: 'fa-id-card' },
            { label: 'Student Card',          path: app.path_student_card,  icon: 'fa-address-card' },
            { label: 'Proof of Registration', path: app.path_registration,  icon: 'fa-file-lines' },
            { label: 'Bank Statement',        path: app.path_bank_statement, icon: 'fa-file-invoice-dollar' },
            { label: 'Selfie',               path: app.path_selfie,         icon: 'fa-camera' },
            { label: 'NSFAS Status',          path: app.path_nsfas,         icon: 'fa-file-contract' },
            { label: 'Proof of Address',      path: app.path_address,       icon: 'fa-house' },
        ];

        const signedUrlResults = await Promise.all(docFields.map(async (doc) => {
            if (!doc.path) return { ...doc, signedUrl: null };
            try {
                const resp = await fetch(`${API_BASE_URL}/admin/document-url?path=${encodeURIComponent(doc.path)}`, {
                    headers: { 'Authorization': authToken }
                });
                const result = await resp.json();
                return { ...doc, signedUrl: result.success ? result.url : null };
            } catch {
                return { ...doc, signedUrl: null };
            }
        }));

        const gallery = document.getElementById('docGallery');
        if (gallery) {
            gallery.innerHTML = signedUrlResults.map(doc => createDocPreview(doc.label, doc.signedUrl, doc.icon)).join('');
        }
    }

    function createDocPreview(name, url, icon) {
        if (!url) return `<div class="document-preview"><span><i class="fa-solid ${icon}"></i> ${name}</span><span style="color:var(--danger)">Missing</span></div>`;
        
        const isPdf = url.toLowerCase().includes('.pdf') || url.includes('content-type=application%2Fpdf');
        
        if (isPdf) {
            return `
            <div class="document-preview">
                <span><i class="fa-solid ${icon}"></i> ${name}</span>
                <iframe src="${url}" title="${name}" style="width:100%; height:120px; border:none; border-radius:4px;"></iframe>
                <a href="${url}" target="_blank" style="font-size:0.75rem; color:var(--primary-color); margin-top:0.5rem; text-decoration:none;">Open Full <i class="fa-solid fa-external-link-alt"></i></a>
            </div>
            `;
        } else {
            return `
            <div class="document-preview">
                <span><i class="fa-solid ${icon}"></i> ${name}</span>
                <a href="${url}" target="_blank">
                    <img src="${url}" alt="${name}" onerror="this.onerror=null; this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22150%22 height=%22120%22 viewBox=%220 0 150 120%22%3E%3Crect width=%22150%22 height=%22120%22 fill=%22%231e293b%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-family=%22sans-serif%22 font-size=%2214%22 fill=%22%2394a3b8%22 text-anchor=%22middle%22 dy=%22.3em%22%3ENo Preview%3C/text%3E%3C/svg%3E';">
                </a>
                <a href="${url}" target="_blank" style="font-size:0.75rem; color:var(--primary-color); margin-top:0.5rem; text-decoration:none;">Open Full <i class="fa-solid fa-external-link-alt"></i></a>
            </div>
            `;
        }
    }

    closeModalBtn.addEventListener('click', () => {
        detailsModal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target == detailsModal) {
            detailsModal.style.display = 'none';
        }
    });

    // Update Status
    updateStatusBtn.addEventListener('click', async () => {
        if (!currentSelectedAppId) return;
        
        const newStatus = statusSelect.value;
        const originalText = updateStatusBtn.textContent;
        updateStatusBtn.textContent = 'Updating...';
        updateStatusBtn.disabled = true;
        
        try {
            const response = await fetch(`${API_BASE_URL}/admin/update-status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authToken
                },
                body: JSON.stringify({
                    id: currentSelectedAppId,
                    status: newStatus
                })
            });
            
            const data = await response.json();
            if (data.success) {
                // Update local data
                const appIndex = applicationsData.findIndex(a => a.id == currentSelectedAppId);
                if (appIndex !== -1) {
                    applicationsData[appIndex].status = newStatus;
                }
                
                // Re-render
                renderTable(searchInput.value ? applicationsData.filter(app => app.reference_number.toLowerCase().includes(searchInput.value.toLowerCase())) : applicationsData);
                updateStats(applicationsData);
                
                // Close modal
                detailsModal.style.display = 'none';
            } else {
                alert('Failed to update status.');
            }
        } catch (error) {
            console.error('Error updating status:', error);
            alert('Server error while updating status.');
        } finally {
            updateStatusBtn.textContent = originalText;
            updateStatusBtn.disabled = false;
        }
    });

    // Navigation logic
    const navBtns = document.querySelectorAll('.nav-btn');
    const contentAreas = document.querySelectorAll('.content-area');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            navBtns.forEach(b => b.parentElement.classList.remove('active'));
            btn.parentElement.classList.add('active');
            contentAreas.forEach(area => area.style.display = 'none');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).style.display = 'block';
        });
    });

    // Settings Logic
    async function loadSettings() {
        try {
            const response = await fetch(`${API_BASE_URL}/settings`);
            const data = await response.json();
            if (data.success && data.data) {
                if (data.data.whatsapp_number) {
                    document.getElementById('setting-whatsapp').value = data.data.whatsapp_number;
                }
                if (data.data.business_email) {
                    document.getElementById('setting-email').value = data.data.business_email;
                }
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    document.getElementById('saveSettingsBtn').addEventListener('click', async (e) => {
        const btn = e.target;
        const msg = document.getElementById('settingsMsg');
        const whatsapp = document.getElementById('setting-whatsapp').value.trim();
        const email = document.getElementById('setting-email').value.trim();
        
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
        btn.disabled = true;
        msg.textContent = '';

        try {
            // Save both settings
            const promises = [
                fetch(`${API_BASE_URL}/admin/settings`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authToken
                    },
                    body: JSON.stringify({ key: 'whatsapp_number', value: whatsapp })
                }),
                fetch(`${API_BASE_URL}/admin/settings`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authToken
                    },
                    body: JSON.stringify({ key: 'business_email', value: email })
                })
            ];

            const results = await Promise.all(promises);
            const allSuccessful = results.every(r => r.ok);

            if (allSuccessful) {
                msg.textContent = 'Settings saved successfully!';
                msg.style.color = 'var(--success)';
            } else {
                msg.textContent = 'Failed to save settings.';
                msg.style.color = 'var(--danger)';
            }
        } catch (error) {
            msg.textContent = 'Network error saving settings.';
            msg.style.color = 'var(--danger)';
        }
        
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        
        setTimeout(() => { msg.textContent = ''; }, 3000);
    });
});
