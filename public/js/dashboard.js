// Utility: Debounce function to limit rate of execution
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

let currentLeadPhone = null;
let lastMessageDate = null;
let editingFlowId = null;

function getFormattedDate(date) {
    const now = new Date();
    const messageDate = new Date(date);

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const checkDate = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());

    if (checkDate.getTime() === today.getTime()) {
        return "Today";
    } else if (checkDate.getTime() === yesterday.getTime()) {
        return "Yesterday";
    } else {
        return messageDate.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    }
}

function normalizePhone(phone) {
    if (!phone) return "";
    let clean = String(phone).replace(/\D/g, "");
    if (clean.length === 10) return "91" + clean;
    return clean;
}

function showContent(contentId) {
    document.querySelectorAll('.page-content, .page-content-fluid').forEach(content => {
        content.style.display = 'none';
    });
    const selected = document.getElementById(contentId);
    if (selected) {
        selected.style.display = contentId === 'live-chat' ? 'flex' : 'block';
        if (contentId === 'live-chat') {
            selected.classList.add('flex-column');
        }

        // Lazily render content if it was skipped during fetchLeads
        if (contentId === 'leads') renderLeadCards(allLeads);
        if (contentId === 'flows') fetchFlows();
        if (contentId === 'flow-builder') loadAdvancedFlows();
    }

    document.querySelectorAll('#sidebar .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const activeLink = document.querySelector(`#sidebar .nav-link[onclick*="${contentId}"]`);
    if (activeLink) activeLink.classList.add('active');
}

let allLeads = [];
let visibleLeadsCount = 50; // Increased initial count for better UX
let visibleSidebarCount = 50;
let oldestMessageTimestamp = null;
let isLoadingMoreMessages = false;
let hasMoreMessages = true;


async function triggerManualSync() {
    const btn = document.querySelector('button[onclick="triggerManualSync()"]');
    const icon = btn.querySelector('i');
    const originalIconClass = icon.className;

    try {
        btn.disabled = true;
        icon.className = 'spinner-border spinner-border-sm me-1';

        const response = await fetch('/api/sync', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            // Show success feedback
            icon.className = 'bi bi-check-circle-fill me-1';
            btn.classList.replace('btn-outline-success', 'btn-success');
            setTimeout(() => {
                icon.className = originalIconClass;
                btn.classList.replace('btn-success', 'btn-outline-success');
                btn.disabled = false;
            }, 2000);

            // Refresh data
            fetchLeads();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Sync failed:', error);
        icon.className = 'bi bi-exclamation-circle-fill me-1 text-danger';
        alert('Sync failed: ' + error.message);
        btn.disabled = false;
        setTimeout(() => {
            icon.className = originalIconClass;
        }, 3000);
    }
}

async function fetchLeads() {
    try {
        const response = await fetch('/api/leads');
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to fetch leads');
        }
        allLeads = await response.json();
        updateLeadStats();

        // Only render visible tab components to save resources
        const leadsVisible = document.getElementById('leads').style.display !== 'none';
        if (leadsVisible) {
            visibleLeadsCount = 50; // Reset visible count on full fetch
            renderLeadCards(allLeads);
        }

        renderChatSidebar(allLeads);
    } catch (error) {
        console.error('Error fetching leads:', error);
        const container = document.getElementById('lead-cards-container');
        if (container) {
            container.innerHTML = `
                    <div class="text-center py-5 text-danger">
                        <i class="bi bi-exclamation-triangle" style="font-size: 3rem;"></i>
                        <p class="mt-3">Error: ${error.message}</p>
                        <button class="btn btn-outline-danger btn-sm mt-2" onclick="fetchLeads()">Try Again</button>
                    </div>`;
        }
        if (typeof toast !== 'undefined') toast.error('Fetch Error', error.message);
    }
}

function renderChatSidebar(leads) {
    const container = document.getElementById('chat-sidebar-list');
    if (!container) return;

    // Sort by unread messages first, then by updated date
    const sortedLeads = [...leads].sort((a, b) => {
        if ((b.unreadMessages || 0) !== (a.unreadMessages || 0)) {
            return (b.unreadMessages || 0) - (a.unreadMessages || 0);
        }
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

    const currentPhoneNorm = normalizePhone(currentLeadPhone);
    const displayLeads = sortedLeads.slice(0, visibleSidebarCount);

    const html = displayLeads.map(lead => {
        const isActive = normalizePhone(lead.phone) === currentPhoneNorm;
        const initials = (lead.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        const unreadBadge = (lead.unreadMessages || 0) > 0 ? `<span class="badge rounded-pill bg-success ms-auto">${lead.unreadMessages}</span>` : '';
        const gradient = stringToGradient(lead.phone);
        const timeStr = lead.updatedAt ? new Date(lead.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        return `
                    <div class="chat-list-item ${isActive ? 'active' : ''}" 
                         data-phone="${lead.phone}" 
                         data-name="${lead.name || 'Unknown'}"
                         style="cursor: pointer;">
                        <div class="lead-avatar" style="width: 48px; height: 48px; font-size: 0.9rem; background: ${gradient}">${initials}</div>
                        <div class="flex-grow-1 overflow-hidden">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6 class="mb-0 fw-bold text-main text-truncate">${lead.name || 'Unknown'}</h6>
                                <small class="text-secondary" style="font-size: 0.7rem;">${timeStr}</small>
                            </div>
                            <div class="d-flex align-items-center gap-1 mt-1">
                                <small class="text-secondary text-truncate" style="font-size: 0.75rem;">+${lead.phone}</small>
                                ${unreadBadge}
                            </div>
                        </div>
                    </div>
                `;
    }).join('');

    container.innerHTML = html;

    // Add "Load More" button to sidebar if needed
    if (leads.length > visibleSidebarCount) {
        const loadMoreBtn = document.createElement('div');
        loadMoreBtn.className = 'text-center py-2 border-top border-light opacity-50';
        loadMoreBtn.style.cursor = 'pointer';
        loadMoreBtn.innerHTML = '<small><i class="bi bi-plus-circle me-1"></i> Load more contacts</small>';
        loadMoreBtn.onclick = () => {
            visibleSidebarCount += 100;
            renderChatSidebar(leads);
        };
        container.appendChild(loadMoreBtn);
    }
}


// Global event delegation for chat sidebar items
document.addEventListener('click', (e) => {
    const item = e.target.closest('.chat-list-item');
    if (item) {
        const phone = item.getAttribute('data-phone');
        const name = item.getAttribute('data-name');
        if (phone) openChat(phone, name);
    }
});

// Debounced Chat Sidebar Filter
window.filterChatSidebar = debounce(function () {
    const term = (document.getElementById('chat-sidebar-search')?.value || '').toLowerCase();
    const filtered = allLeads.filter(l => (l.name || '').toLowerCase().includes(term) || l.phone.includes(term));
    renderChatSidebar(filtered);
}, 300);

const gradientCache = new Map();
function stringToGradient(str) {
    if (gradientCache.has(str)) return gradientCache.get(str);
    const gradients = [
        'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        'linear-gradient(135deg, #00b09b 0%, #96c93d 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)'
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const res = gradients[Math.abs(hash) % gradients.length];
    gradientCache.set(str, res);
    return res;
}

function updateLeadStats() {
    if (!document.getElementById('stat-total-leads')) return;
    document.getElementById('stat-total-leads').textContent = allLeads.length;
    document.getElementById('stat-completed-leads').textContent = allLeads.filter(l => l.completed).length;
    document.getElementById('stat-pending-leads').textContent = allLeads.filter(l => !l.completed).length;
    document.getElementById('stat-unread-leads').textContent = allLeads.reduce((acc, l) => acc + (l.unreadMessages || 0), 0);
}

function renderLeadCards(leads) {
    const container = document.getElementById('lead-cards-container');
    if (!container) return;
    container.innerHTML = '';

    if (leads.length === 0) {
        container.innerHTML = `
                    <div class="text-center py-5 opacity-50">
                        <i class="bi bi-inbox" style="font-size: 4rem;"></i>
                        <p class="mt-3">No leads found matching your criteria.</p>
                    </div>
                `;
        return;
    }

    const gradients = [
        'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        'linear-gradient(135deg, #00b09b 0%, #96c93d 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)',
        'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)'
    ];

    const displayLeads = leads.slice(0, visibleLeadsCount);

    displayLeads.forEach((lead, index) => {
        const card = document.createElement('div');
        card.className = 'lead-card';
        card.setAttribute('data-lead-id', lead._id);

        const gradient = gradients[index % gradients.length];
        const genderIcon = (lead.gender || '').trim().toLowerCase() === 'male' ? 'bi-gender-male' : (lead.gender || '').trim().toLowerCase() === 'female' ? 'bi-gender-female' : 'bi-gender-ambiguous';
        const initials = (lead.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        const unreadBadge = (lead.unreadMessages || 0) > 0 ? `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-light" style="z-index: 10;">${lead.unreadMessages}</span>` : '';

        card.innerHTML = `
                    <div class="row align-items-center">
                        <div class="col-auto">
                            <div class="position-relative">
                                <div class="lead-avatar" style="background: ${gradient}">${initials}</div>
                                ${unreadBadge}
                            </div>
                        </div>
                        <div class="col-md-3">
                            <h5 class="mb-1 fw-bold text-main">${lead.name || 'Unknown User'}</h5>
                            <div class="d-flex gap-2">
                                <span class="lead-info-chip"><i class="bi bi-whatsapp"></i> ${formatPhone(lead.phone)}</span>
                                <span class="lead-info-chip"><i class="bi bi-tag"></i> ID: ${lead.phone.slice(-4)}</span>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="d-flex flex-wrap gap-2 mb-2">
                                <span class="lead-info-chip border border-primary-subtle"><i class="bi ${genderIcon}"></i> ${lead.gender || 'N/A'}</span>
                                <span class="lead-info-chip border border-info-subtle"><i class="bi bi-calendar"></i> ${lead.age || '??'} yrs</span>
                            </div>
                            <div class="d-flex gap-3 small text-secondary">
                                <span><i class="bi bi-speedometer2 me-1"></i> ${lead.weight || '-'}kg</span>
                                <span><i class="bi bi-rulers me-1"></i> ${lead.height || '-'}cm</span>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="small mb-1"><i class="bi bi-geo-alt text-danger me-2"></i> ${lead.place || 'Location not set'}</div>
                            <div class="small text-truncate" style="max-width: 250px;"><i class="bi bi-heart-pulse text-info me-2"></i> ${lead.health_issues || 'No health issues reported'}</div>
                            ${lead.remarks ? `<div class="small text-truncate mt-1 text-muted" style="max-width: 250px;" title="${lead.remarks}"><i class="bi bi-journal-text text-warning me-2"></i> ${lead.remarks}</div>` : ''}
                        </div>
                        <div class="col text-end">
                            <div class="mb-2">
                                ${lead.completed
                ? '<span class="badge bg-success-subtle text-success border border-success-subtle px-3 py-2 rounded-pill"><i class="bi bi-check-all me-1"></i> Verified Lead</span>'
                : '<span class="badge bg-warning-subtle text-warning border border-warning-subtle px-3 py-2 rounded-pill"><i class="bi bi-clock-history me-1"></i> In Pipeline</span>'}
                            </div>
                            <div class="d-flex justify-content-end gap-2">
                                <button class="btn btn-outline-primary btn-sm rounded-pill px-3" onclick="openChat('${lead.phone}', '${lead.name || 'Unknown'}')">
                                    <i class="bi bi-chat-quote-fill me-1"></i> Open Chat
                                </button>
                                <div class="dropdown">
                                    <button class="btn btn-dark btn-sm rounded-circle" data-bs-toggle="dropdown" style="width: 32px; height: 32px; padding: 0;">
                                        <i class="bi bi-three-dots-vertical"></i>
                                    </button>
                                    <ul class="dropdown-menu shadow border-0">
                                        <li><a class="dropdown-item" href="#" onclick="editLead('${lead._id}')"><i class="bi bi-pencil me-2"></i> Edit Lead</a></li>
                                        <li><a class="dropdown-item" href="#" onclick="scheduleCall('${lead._id}')"><i class="bi bi-calendar-plus me-2"></i> Reschedule Call</a></li>
                                        <li><hr class="dropdown-divider"></li>
                                        <li><a class="dropdown-item text-danger" href="#" onclick="archiveLead('${lead._id}')"><i class="bi bi-trash me-2"></i> Delete Lead</a></li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 pt-3 border-top border-light opacity-50 d-flex justify-content-between align-items-center small">
                        <span><i class="bi bi-calendar-check me-2"></i> Preferred Call: On <strong>${lead.preferred_date || 'Today'}</strong> Between <strong>${lead.preferred_time || 'Anytime'}</strong></span>
                        <span>Created ${new Date(lead.createdAt || Date.now()).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                `;
        container.appendChild(card);
    });


    if (leads.length > visibleLeadsCount) {
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'text-center py-4';
        loadMoreContainer.innerHTML = `
                    <button class="btn btn-outline-primary rounded-pill px-4" onclick="loadMoreLeads()">
                        <i class="bi bi-arrow-down-circle me-2"></i> Load More Leads
                    </button>
                    <div class="text-muted small mt-2">Showing ${visibleLeadsCount} of ${leads.length} leads</div>
                `;
        container.appendChild(loadMoreContainer);
    }
}

function loadMoreLeads() {
    if (visibleLeadsCount >= allLeads.length) return;
    visibleLeadsCount += 50;
    renderLeadCards(allLeads);
}

// Add infinite scroll for leads tab
document.getElementById('content').addEventListener('scroll', function (e) {
    const content = e.target;
    const leadsPage = document.getElementById('leads');
    if (leadsPage && leadsPage.style.display !== 'none') {
        if (content.scrollHeight - content.scrollTop - content.clientHeight < 300) {
            // Simple throttle
            if (!window._isFetchingLeads) {
                window._isFetchingLeads = true;
                loadMoreLeads();
                setTimeout(() => window._isFetchingLeads = false, 200);
            }
        }
    }
});

// Debounced Lead Cards Filter
window.filterLeadCards = debounce(function () {
    const searchTerm = (document.getElementById('lead-search')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('lead-filter-status')?.value || 'all';

    const filtered = allLeads.filter(lead => {
        const matchesSearch = (lead.name || '').toLowerCase().includes(searchTerm) || lead.phone.includes(searchTerm);
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'completed' && lead.completed) ||
            (statusFilter === 'pending' && !lead.completed);
        return matchesSearch && matchesStatus;
    });

    renderLeadCards(filtered);
}, 300);

// --- Lead Management Actions ---
let isEditingLead = false;
let editingLeadId = null;

function editLead(id) {
    const lead = allLeads.find(l => l._id === id);
    if (!lead) return;

    isEditingLead = true;
    editingLeadId = id;
    document.querySelector('#addLeadModal .modal-title').innerText = 'Edit Lead Details';
    document.querySelector('#addLeadModal button[type="submit"]').innerText = 'Update Lead';

    document.getElementById('lead-name').value = lead.name || '';
    document.getElementById('lead-phone').value = lead.phone || '';
    // document.getElementById('lead-phone').readOnly = true; 
    document.getElementById('lead-age').value = lead.age || '';
    document.getElementById('lead-weight').value = lead.weight || '';
    document.getElementById('lead-height').value = lead.height || '';
    document.getElementById('lead-gender').value = lead.gender || '';
    document.getElementById('lead-place').value = lead.place || '';
    document.getElementById('lead-health').value = lead.health_issues || '';
    document.getElementById('lead-remarks').value = lead.remarks || '';
    document.getElementById('lead-pref-date').value = lead.preferred_date || '';
    document.getElementById('lead-pref-time').value = lead.preferred_time || '';

    const modal = new bootstrap.Modal(document.getElementById('addLeadModal'));
    modal.show();
}

// Reset modal on close or when adding
document.getElementById('addLeadModal').addEventListener('hidden.bs.modal', () => {
    isEditingLead = false;
    editingLeadId = null;
    document.querySelector('#addLeadModal .modal-title').innerText = 'Add New Lead Manually';
    document.querySelector('#addLeadModal button[type="submit"]').innerText = 'Save Lead';
    document.getElementById('lead-phone').readOnly = false;
    document.getElementById('add-lead-form').reset();
});

async function archiveLead(id) {
    const lead = allLeads.find(l => l._id === id);
    if (!lead) return;
    if (!confirm(`Are you sure you want to archive lead ${lead.name || lead.phone}? This will permanently remove them from the dashboard.`)) return;

    try {
        const res = await fetch(`/api/leads/id/${id}`, { method: 'DELETE' });
        if (res.ok) {
            fetchLeads();
        } else {
            const err = await res.json().catch(() => ({}));
            alert("Failed to archive lead: " + (err.error || res.statusText || "Unknown error"));
        }
    } catch (err) {
        console.error("Error archiving lead:", err);
        alert("Network error while archiving lead. Is the server running?");
    }
}


function scheduleCall(id) {
    document.getElementById('schedule-lead-phone').value = id; // reuse for id
    const lead = allLeads.find(l => l._id === id);
    if (lead) {
        document.getElementById('schedule-date').value = lead.preferred_date || '';
        document.getElementById('call-schedule-time').value = lead.preferred_time || '';
    }
    const modal = new bootstrap.Modal(document.getElementById('scheduleCallModal'));
    modal.show();
}

document.getElementById('schedule-call-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('schedule-lead-phone').value;
    const data = {
        preferred_date: document.getElementById('schedule-date').value,
        preferred_time: document.getElementById('call-schedule-time').value
    };

    try {
        const res = await fetch(`/api/leads/id/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            fetchLeads();
            bootstrap.Modal.getInstance(document.getElementById('scheduleCallModal')).hide();
        } else {
            alert("Failed to update schedule");
        }
    } catch (err) {
        console.error("Error updating schedule:", err);
    }
});

document.getElementById('add-lead-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('lead-phone').value.replace(/\D/g, '');
    const leadData = {
        name: document.getElementById('lead-name').value,
        phone: phone,
        age: document.getElementById('lead-age').value,
        weight: document.getElementById('lead-weight').value,
        height: document.getElementById('lead-height').value,
        gender: document.getElementById('lead-gender').value,
        place: document.getElementById('lead-place').value,
        health_issues: document.getElementById('lead-health').value,
        remarks: document.getElementById('lead-remarks').value,
        preferred_date: document.getElementById('lead-pref-date').value,
        preferred_time: document.getElementById('lead-pref-time').value,
        completed: true
    };

    const url = isEditingLead ? `/api/leads/id/${editingLeadId}` : '/api/leads';
    const method = isEditingLead ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadData)
        });

        if (res.ok) {
            fetchLeads();
            const modalEl = document.getElementById('addLeadModal');
            const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modal.hide();
            document.getElementById('add-lead-form').reset();
        } else {
            const err = await res.json();
            alert("Error: " + (err.error || "Failed to save lead"));
        }
    } catch (err) {
        console.error("Error saving lead", err);
        alert("Failed to save lead");
    }
});


function formatPhone(phone) {
    // Basic formatting (assumed string)
    return phone.replace(/(\d{2})(\d{5})(\d{5})/, '+$1 $2 $3');
}

async function openChat(phone, name) {
    if (!phone) return;
    const targetPhone = normalizePhone(phone);

    try {
        currentLeadPhone = targetPhone;
        // Reset pagination state
        oldestMessageTimestamp = null;
        hasMoreMessages = true;
        isLoadingMoreMessages = false;

        // Switch to live chat tab
        showContent('live-chat');

        // Ensure UI elements are visible
        const welcome = document.getElementById('chat-welcome-screen');
        const inputArea = document.getElementById('chat-input-area');
        if (welcome) welcome.style.display = 'none';
        if (inputArea) inputArea.style.display = 'flex';

        // Update sidebar highlight immediately
        document.querySelectorAll('.chat-list-item').forEach(item => {
            const itemPhone = normalizePhone(item.getAttribute('data-phone'));
            item.classList.toggle('active', itemPhone === targetPhone);
        });

        // Update Header info
        const chatTitle = document.getElementById('chat-title');
        const chatSubtitle = document.getElementById('chat-subtitle');
        if (chatTitle) chatTitle.innerText = name || 'Unknown';
        if (chatSubtitle) chatSubtitle.innerHTML = `<span class="presence-dot presence-online"></span> Active now on +${targetPhone}`;

        // Update Avatar
        const initials = (name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
        const avatar = document.getElementById('active-chat-avatar');
        if (avatar) {
            avatar.innerText = initials;
            avatar.style.background = stringToGradient(targetPhone);
        }

        // Initial messages load
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>';
        }

        const response = await fetch(`/api/messages/${targetPhone}?limit=40`);
        if (!response.ok) throw new Error('Network response was not ok');
        const messages = await response.json();

        if (chatContainer) {
            chatContainer.innerHTML = '';
            lastMessageDate = null;

            if (messages.length > 0) {
                // The server returns messages in ascending order (oldest first)
                oldestMessageTimestamp = messages[0].timestamp || messages[0].createdAt;

                if (!oldestMessageTimestamp) {
                    console.warn('Warning: First message in batch missing timestamp.');
                }

                if (messages.length < 40) hasMoreMessages = false;

                let bulkHtml = '';
                messages.forEach(msg => {
                    bulkHtml += getMessageHtml(msg, targetPhone);
                });
                chatContainer.innerHTML = bulkHtml;
                chatContainer.scrollTop = chatContainer.scrollHeight;

                // Add scroll listener for pagination
                chatContainer.onscroll = handleChatScroll;
            } else {
                hasMoreMessages = false;
                chatContainer.innerHTML = '<div class="text-center py-5 opacity-50"><i class="bi bi-chat-dots fs-1"></i><p class="mt-2">No messages yet. Send a message to start the conversation!</p></div>';
            }
        }

        // Mark as read
        fetch(`/api/leads/${targetPhone}/read`, { method: 'POST' });
        const lead = allLeads.find(l => normalizePhone(l.phone) === targetPhone);
        if (lead) {
            lead.unreadMessages = 0;
            updateLeadStats();
            const item = document.querySelector(`.chat-list-item[data-phone="${lead.phone}"]`);
            if (item) {
                const badge = item.querySelector('.badge');
                if (badge) badge.remove();
            }
        }

        const msgInput = document.getElementById('message-input');
        if (msgInput) msgInput.focus();

    } catch (error) {
        console.error('Error switching chats:', error);
    }
}

async function handleChatScroll(e) {
    const container = e.target;
    if (container.scrollTop < 50 && !isLoadingMoreMessages && hasMoreMessages && currentLeadPhone) {
        loadMoreMessages();
    }
}

async function loadMoreMessages() {
    if (isLoadingMoreMessages || !hasMoreMessages || !currentLeadPhone) return;

    isLoadingMoreMessages = true;
    const chatContainer = document.getElementById('chat-container');
    const prevScrollHeight = chatContainer.scrollHeight;
    const prevScrollTop = chatContainer.scrollTop;

    // Show a small loader at top
    const loader = document.createElement('div');
    loader.id = 'chat-load-more-spinner';
    loader.className = 'text-center py-2';
    loader.innerHTML = '<div class="spinner-border spinner-border-sm text-secondary" role="status"></div>';
    chatContainer.prepend(loader);

    try {
        const response = await fetch(`/api/messages/${currentLeadPhone}?limit=40&before=${oldestMessageTimestamp}`);
        if (!response.ok) throw new Error('Failed to load history');

        const messages = await response.json();
        loader.remove();

        if (messages.length === 0) {
            hasMoreMessages = false;
            return;
        }

        if (messages.length < 40) hasMoreMessages = false;

        if (messages.length > 0) {
            oldestMessageTimestamp = messages[0].timestamp || messages[0].createdAt;
        }


        // Prepend original messages
        // We need to reset lastMessageDate for history to recalculate date dividers correctly
        // Actually, history dividers are tricky when prepending. 
        // Let's just re-render or carefully prepend. 
        // For simplicity and since we don't have thousands, prepending HTML is okay.

        // IMPORTANT: date dividers depend on 'lastMessageDate' which is a global.
        // When loading older messages, we should reset it so dividers are correct for the batch.
        const tempLastDate = lastMessageDate;
        lastMessageDate = null;

        let bulkHtml = '';
        messages.forEach(msg => {
            bulkHtml += getMessageHtml(msg, currentLeadPhone);
        });

        // We need to fix the divider between these old messages and the previous ones
        // if they are on the same day. getMessageHtml would have added a divider for the first one.

        chatContainer.insertAdjacentHTML('afterbegin', bulkHtml);

        // Restore scroll position
        chatContainer.scrollTop = chatContainer.scrollHeight - prevScrollHeight + prevScrollTop;

    } catch (error) {
        console.error('Error loading more messages:', error);
        if (loader) loader.remove();
    } finally {
        isLoadingMoreMessages = false;
    }
}


function getMessageHtml(message, normalizedTargetPhone = null) {
    let html = '';
    const timestamp = message.timestamp || message.createdAt || Date.now();
    const msgDate = new Date(timestamp);
    const dateStr = msgDate.toDateString();

    if (dateStr !== lastMessageDate) {
        html += `<div class="chat-date-divider">${getFormattedDate(msgDate)}</div>`;
        lastMessageDate = dateStr;
    }

    const mFrom = normalizePhone(message.from || '');
    const targetPhone = normalizedTargetPhone || normalizePhone(currentLeadPhone || '');
    const isFromDashboard = message.from === 'dashboard';
    const isFromLead = mFrom === targetPhone;
    const time = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let contentHtml = `<div class="message-text">${message.text}</div>`;
    const mediaRegex = /^\[(image|video|document)\]\s*(.*)$/;
    const match = message.text.match(mediaRegex);

    if (match) {
        const type = match[1];
        const parts = match[2].split(' ');
        const url = parts.find(p => p.startsWith('/uploads/'));
        const caption = match[2].replace(url || '', '').trim();

        if (url) {
            if (type === 'image') {
                contentHtml = `<div class="message-media mb-2"><img src="${url}" style="max-width: 100%; border-radius: 8px; cursor: pointer;" onclick="window.open('${url}')"></div>`;
            } else if (type === 'video') {
                contentHtml = `<div class="message-media mb-2"><video src="${url}" controls style="max-width: 100%; border-radius: 8px;"></video></div>`;
            } else if (type === 'document') {
                contentHtml = `<div class="message-media mb-2"><div class="p-2 rounded bg-dark bg-opacity-25 d-flex align-items-center gap-2"><i class="bi bi-file-earmark-text fs-4"></i> <a href="${url}" target="_blank" class="text-white text-decoration-none small text-truncate" style="max-width: 150px;">Document</a></div></div>`;
            }
            if (caption) contentHtml += `<div class="message-text">${caption}</div>`;
        }
    }

    let bubbleClass = 'chat-bubble ai';
    let statusHtml = '';

    if (isFromDashboard) {
        bubbleClass = 'chat-bubble sent';
        statusHtml = ` <i class="bi bi-check2-all" style="color: #53bdeb; font-size: 0.8rem;"></i>`;
        html += `
                    <div class="${bubbleClass}">
                        ${contentHtml}
                        <div class="chat-time">${time}${statusHtml}</div>
                    </div>
                `;
    } else if (isFromLead) {
        bubbleClass = 'chat-bubble received';
        html += `
                    <div class="${bubbleClass}">
                        ${contentHtml}
                        <div class="chat-time">${time}</div>
                    </div>
                `;
    } else {
        html += `
                    <div class="${bubbleClass}">
                        <div class="message-text">
                            <small style="color: #00e676; font-size: 0.7rem; font-weight: bold; display: block; margin-bottom: 2px;">
                                <i class="bi bi-robot"></i> AI ASSISTANT
                            </small>
                            ${message.text}
                        </div>
                        <div class="chat-time">${time}</div>
                    </div>
                `;
    }
    return html;
}

function displayMessage(message, shouldScroll = true) {
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer) return;

    // Appending a single message is fine with insertAdjacentHTML
    const html = getMessageHtml(message);
    chatContainer.insertAdjacentHTML('beforeend', html);

    if (shouldScroll) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}



document.getElementById('send-button').addEventListener('click', () => sendMessage());
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Emoji & Attachments Logic
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('chat-file-input');
const msgInput = document.getElementById('message-input');

if (emojiBtn && emojiPicker) {
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.style.display = 'none';
        }
    });

    emojiPicker.querySelectorAll('span').forEach(span => {
        span.addEventListener('click', () => {
            msgInput.value += span.innerText;
            msgInput.focus();
            emojiPicker.style.display = 'none';
        });
    });
}

if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (res.ok) {
                    let type = 'document';
                    if (file.type.startsWith('image/')) type = 'image';
                    else if (file.type.startsWith('video/')) type = 'video';

                    const text = prompt('Enter a caption (optional):');
                    await sendMessage(data.url, type, file.name, text);
                } else {
                    alert('Upload failed: ' + data.error);
                }
            } catch (err) {
                console.error('Upload Error:', err);
                alert('Upload failed.');
            }
            fileInput.value = ''; // Reset
        }
    });
}


async function sendMessage(mediaUrl = null, messageType = null, originalName = null, caption = null) {
    if (mediaUrl instanceof Event || (mediaUrl && typeof mediaUrl === 'object' && mediaUrl.type)) {
        mediaUrl = null;
    }
    const messageInput = document.getElementById('message-input');
    const text = caption || messageInput.value;

    if ((text || mediaUrl) && currentLeadPhone) {
        // Optimistic UI update: Show the message immediately
        const tempMsg = {
            from: 'dashboard',
            to: currentLeadPhone,
            text: mediaUrl ? `[${messageType}] ${mediaUrl} ${text || ''}` : text,
            timestamp: new Date().toISOString()
        };
        displayMessage(tempMsg, true);
        if (!mediaUrl) messageInput.value = '';

        try {
            const body = {
                to: currentLeadPhone,
                text: text
            };
            if (mediaUrl) {
                const base = mediaUrl.startsWith('/') ? window.location.origin : '';
                body.mediaUrl = base + mediaUrl;
                body.messageType = messageType;
                body.filename = originalName;
            }

            const res = await fetch('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errData = await res.json();
                toast.error('Send Failed', errData.error || 'Message could not be sent.');
            }

        } catch (e) {
            console.error("Send failed Network Error", e);
            toast.error('Network Error', 'Connection lost while sending message.');
        }
    }
}

const socket = io();
socket.on('newMessage', (message) => {
    const mFrom = normalizePhone(message.from);
    const mTo = normalizePhone(message.to);
    const curPhone = normalizePhone(currentLeadPhone);

    if (mFrom === curPhone || mTo === curPhone) {
        // If it's from dashboard, we might have already shown it optimistically
        // But specifically for 'dashboard' messages, socket tells us it's confirmed.
        // To keep it simple and avoid complex deduplication, we check if the last message
        // text and sender matches.
        const chatContainer = document.getElementById('chat-container');
        const lastBubble = chatContainer.lastElementChild;
        const isOptimisticMatch = message.from === 'dashboard' &&
            lastBubble &&
            lastBubble.classList.contains('sent') &&
            lastBubble.innerText.includes(message.text.substring(0, 20));

        if (!isOptimisticMatch) {
            displayMessage(message);
        } else if (lastBubble) {
            // Update the optimistic bubble with the real timestamp/status if needed
            lastBubble.querySelector('.chat-time').innerHTML =
                new Date(message.timestamp || message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                ' <i class="bi bi-check2-all" style="color: #53bdeb; font-size: 0.8rem;"></i>';
        }
    }
});

socket.on('messageStatus', (data) => {
    console.log('Message Status Update:', data);
    if (data.status === 'failed') {
        const errorMsg = data.errors?.[0]?.title || 'Message Failed';
        const errorDesc = data.errors?.[0]?.error_data?.details || data.errors?.[0]?.message || 'Unknown reason';

        console.error(`❌ Delivery Failed: ${errorMsg} - ${errorDesc}`);

        if (window.toast && window.toast.error) {
            window.toast.error('Delivery Failed', `${errorMsg}: ${errorDesc}`, 8000);
        } else {
            alert(`❌ Delivery Failed: ${errorMsg}\n${errorDesc}`);
        }
    }
});

socket.on('leadUpdated', (lead) => {
    // Update local allLeads array without full fetch
    const normalizedPhone = normalizePhone(lead.phone);
    const idx = allLeads.findIndex(l => normalizePhone(l.phone) === normalizedPhone);

    if (idx !== -1) {
        allLeads[idx] = { ...allLeads[idx], ...lead };
    } else {
        allLeads.push(lead); // Add new lead
    }

    // Sort alphabetically by name
    allLeads.sort((a, b) => {
        const nameA = (a.name || 'Unknown').toLowerCase();
        const nameB = (b.name || 'Unknown').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    // Sync stats
    updateLeadStats();

    // Partial Update: Row in Sidebar
    const sidebarItem = document.querySelector(`.chat-list-item[data-phone="${lead.phone}"]`);
    if (sidebarItem) {
        // Update unread count if exists
        const unreadBadge = (lead.unreadMessages || 0) > 0 ? `<span class="badge rounded-pill bg-success ms-auto">${lead.unreadMessages}</span>` : '';
        const badgeContainer = sidebarItem.querySelector('.d-flex.align-items-center.gap-1.mt-1');
        if (badgeContainer) {
            const existingBadge = badgeContainer.querySelector('.badge');
            if (existingBadge) existingBadge.remove();
            if (unreadBadge) badgeContainer.insertAdjacentHTML('beforeend', unreadBadge);
        }

        // Update name/info if changed
        const nameEl = sidebarItem.querySelector('h6');
        if (nameEl && lead.name) nameEl.textContent = lead.name;
    } else {
        // If not in sidebar (e.g. new lead), we might need a full re-render or just prepend
        if (typeof window.filterChatSidebar === 'function') {
            window.filterChatSidebar();
        } else {
            renderChatSidebar(allLeads);
        }
    }

    // Partial Update: Lead Card in Leads Tab
    const leadCard = document.querySelector(`.lead-card[data-lead-id="${lead._id}"]`) || document.querySelector(`.lead-card[data-phone="${lead.phone}"]`);
    if (leadCard) {
        // Simplest: only re-render this specific card if possible, 
        // but for now let's just do a full render of the visible leads to keep it consistent
        if (typeof window.filterLeadCards === 'function') {
            window.filterLeadCards();
        } else {
            renderLeadCards(allLeads);
        }
    } else if (document.getElementById('leads').style.display !== 'none') {
        // New lead and on leads page
        renderLeadCards(allLeads);
    }
});

// Flows Logic
async function fetchFlows() {
    try {
        const response = await fetch('/api/flows');
        const flows = await response.json();
        const container = document.getElementById('flows-container');
        container.innerHTML = '';

        if (flows.length === 0) {
            container.innerHTML = `
                        <div class="col-12">
                            <div class="empty-flows-state">
                                <i class="bi bi-robot text-primary mb-3" style="font-size: 4rem;"></i>
                                <h3 class="fw-bold">No automation flows yet</h3>
                                <p class="text-secondary mx-auto" style="max-width: 400px;">Create your first automated response to handle common customer queries instantly without manual intervention.</p>
                                <button class="btn btn-primary rounded-pill px-4 mt-2" data-bs-toggle="modal" data-bs-target="#newFlowModal">
                                    <i class="bi bi-plus-lg me-2"></i> Create First Flow
                                </button>
                            </div>
                        </div>
                     `;
            return;
        }

        flows.forEach(flow => {
            const card = document.createElement('div');
            card.className = 'col-md-4';
            card.innerHTML = `
                        <div class="flow-card">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="flow-icon-wrapper">
                                    <i class="bi bi-cpu"></i>
                                </div>
                                <div class="dropdown">
                                    <button class="btn btn-link text-secondary p-0" data-bs-toggle="dropdown">
                                        <i class="bi bi-three-dots-vertical fs-5"></i>
                                    </button>
                                    <ul class="dropdown-menu dropdown-menu-end shadow border-0">
                                        <li><a class="dropdown-item" href="#" onclick="editSimpleFlow('${flow._id}', '${flow.trigger.replace(/'/g, "\\'")}', '${flow.response.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')"><i class="bi bi-pencil me-2"></i> Edit Flow</a></li>
                                        <li><hr class="dropdown-divider"></li>
                                        <li><a class="dropdown-item text-danger" href="#" onclick="deleteFlow('${flow._id}')"><i class="bi bi-trash me-2"></i> Delete</a></li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div>
                                <small class="text-secondary text-uppercase fw-bold" style="font-size: 0.7rem; letter-spacing: 1px;">Trigger Keyword</small>
                                <div class="flow-trigger-badge mt-1">
                                    <i class="bi bi-lightning-fill"></i>
                                    ${flow.trigger}
                                </div>
                            </div>

                            <div class="d-flex flex-column gap-1">
                                <small class="text-secondary text-uppercase fw-bold" style="font-size: 0.7rem; letter-spacing: 1px;">Bot Response</small>
                                <div class="flow-response-preview mt-1">
                                    ${flow.response}
                                </div>
                            </div>

                            <div class="flow-actions">
                                <button class="btn btn-modern btn-outline-secondary flex-grow-1" onclick="copyToClipboard('${flow.trigger}')">
                                    <i class="bi bi-files"></i> Copy
                                </button>
                                <button class="btn btn-modern btn-primary text-white" onclick="deleteFlow('${flow._id}')">
                                    <i class="bi bi-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                    `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error fetching flows:', error);
    }
}

document.getElementById('create-flow-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const trigger = document.getElementById('flow-trigger').value.trim();
    const response = document.getElementById('flow-response').value.trim();

    console.log('Attempting to save simple flow:', { editingFlowId, trigger, response });

    try {
        const url = editingFlowId ? `/api/flows/${editingFlowId}` : '/api/flows';
        const method = editingFlowId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger, response })
        });

        if (res.ok) {
            const result = await res.json();
            console.log('Simple flow saved successfully:', result);

            fetchFlows();
            const modalEl = document.getElementById('newFlowModal');
            const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modal.hide();

            document.getElementById('create-flow-form').reset();
            editingFlowId = null;

            alert('Automation Flow saved successfully! 🚀');
        } else {
            const statusText = res.statusText || 'Error';
            try {
                const err = await res.json();
                console.error('Error response:', err);
                alert(`Failed to save flow (${res.status} ${statusText}): ` + (err.error || err.message || 'Unknown error'));
            } catch (e) {
                alert(`Failed to save flow (${res.status} ${statusText})`);
            }
        }
    } catch (err) {
        console.error("Network or Runtime error saving flow:", err);
        alert('An error occurred while saving: ' + err.message + '\n\nPlease check the console (F12) for details.');
    }
});

function editSimpleFlow(id, trigger, response) {
    console.log('Editing simple flow with ID:', id, 'Type:', typeof id);
    editingFlowId = id;
    document.getElementById('flow-trigger').value = trigger;
    document.getElementById('flow-response').value = response;

    // Update modal title
    const modalTitle = document.querySelector('#newFlowModal .modal-title');
    if (modalTitle) modalTitle.innerHTML = '<i class="bi bi-pencil-square me-2 text-primary"></i> Edit Automation Flow';

    const modal = new bootstrap.Modal(document.getElementById('newFlowModal'));
    modal.show();
}

// Add handler for when modal is hidden to reset state
document.getElementById('newFlowModal').addEventListener('hidden.bs.modal', function () {
    editingFlowId = null;
    document.getElementById('create-flow-form').reset();
    const modalTitle = document.querySelector('#newFlowModal .modal-title');
    if (modalTitle) modalTitle.innerHTML = '<i class="bi bi-magic me-2 text-primary"></i> Create Automation Flow';
});

async function deleteFlow(id) {
    if (!confirm('Are you sure you want to delete this flow?')) return;
    await fetch(`/api/flows/${id}`, { method: 'DELETE' });
    fetchFlows();
}

// Initialize
fetchLeads();
fetchFlows();

// ========================================
// BULK MESSAGING FUNCTIONALITY
// ========================================

let allLeadsForBulk = [];
let currentBulkLeads = [];
let displayedLeadsCount = 20;
let selectedRecipients = new Set();
let selectedTemplate = null; // Store selected Meta template

// Performance Optimization: Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const messageTemplates = [
    {
        name: "Welcome Message",
        text: "Hi {name}! 👋\n\nWelcome to our fitness community! We're excited to help you achieve your health goals. 💪\n\nOur team will be in touch soon!"
    },
    {
        name: "Follow-up",
        text: "Hello {name},\n\nJust checking in to see if you have any questions about our program. We're here to help! ðŸ˜Š"
    },
    {
        name: "Special Offer",
        text: "Hey {name}! ðŸŽ‰\n\nWe have a special offer just for you! Get 20% off on our premium fitness program.\n\nReply 'INTERESTED' to learn more!"
    },
    {
        name: "Reminder",
        text: "Hi {name},\n\nThis is a friendly reminder about your scheduled consultation. Looking forward to speaking with you! ðŸ“…"
    },
    {
        name: "Thank You",
        text: "Dear {name},\n\nThank you for your interest! We appreciate you taking the time to connect with us. 🙏\n\nStay healthy and strong!"
    },
    {
        name: "Scheduling Follow-up",
        text: "Hi {name}, regarding your request for a call on {preferred_date} Between {preferred_time}. Are you available?"
    }
];

async function loadBulkRecipients() {
    try {
        const response = await fetch('/api/leads');
        allLeadsForBulk = await response.json();
        currentBulkLeads = [...allLeadsForBulk];
        displayedLeadsCount = 20;
        renderBulkRecipients();
    } catch (error) {
        console.error('Error loading bulk recipients:', error);
    }
}

function renderBulkRecipients() {
    const container = document.getElementById('bulk-recipients-list');

    if (currentBulkLeads.length === 0) {
        container.innerHTML = `
                    <div class="text-center text-muted py-5">
                        <i class="bi bi-inbox" style="font-size: 3rem;"></i>
                        <p class="mt-3">No leads available</p>
                    </div>
                `;
        return;
    }

    const leadsToShow = currentBulkLeads.slice(0, displayedLeadsCount);
    const fragment = document.createDocumentFragment();

    leadsToShow.forEach(lead => {
        const isSelected = selectedRecipients.has(lead.phone);
        const item = document.createElement('div');
        item.className = `p-3 border-bottom bulk-recipient-item ${isSelected ? 'bg-primary-subtle text-primary-emphasis' : 'text-body'}`;
        item.dataset.phone = lead.phone;
        item.style.borderColor = 'var(--border-color)';
        item.style.cursor = 'pointer';
        item.style.transition = 'all 0.2s';
        item.innerHTML = `
                    <div class="form-check">
                        <input class="form-check-input recipient-checkbox" type="checkbox" value="${lead.phone}" 
                            id="recipient-${lead.phone}" ${isSelected ? 'checked' : ''}
                            onchange="toggleRecipient('${lead.phone}', '${lead.name || 'Unknown'}')">
                        <label class="form-check-label w-100" for="recipient-${lead.phone}" style="cursor: pointer;">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <div class="fw-semibold"><i class="bi bi-person-circle me-2"></i>${lead.name || 'Unknown'}</div>
                                    <small class="text-muted">${formatPhone(lead.phone)}</small>
                                </div>
                                <div class="text-end">
                                    ${lead.completed ? '<span class="badge bg-success-subtle text-success border border-success">Completed</span>' : '<span class="badge bg-warning-subtle text-warning border border-warning">In Progress</span>'}
                                </div>
                            </div>
                        </label>
                    </div>
                `;
        fragment.appendChild(item);
    });

    // Load More Button
    if (displayedLeadsCount < currentBulkLeads.length) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.className = 'p-3 text-center border-top bg-body-tertiary';
        loadMoreDiv.innerHTML = `
                    <button class="btn btn-sm btn-outline-primary rounded-pill w-100 py-2" onclick="loadMoreBulkLeads()">
                        <i class="bi bi-plus-circle"></i> Load More (${currentBulkLeads.length - displayedLeadsCount} remaining)
                    </button>
                `;
        fragment.appendChild(loadMoreDiv);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
    updateSelectionCount();
}

function loadMoreBulkLeads() {
    displayedLeadsCount += 20;
    renderBulkRecipients();
}

function toggleRecipient(phone, name) {
    const row = document.querySelector(`.bulk-recipient-item[data-phone="${phone}"]`);
    if (selectedRecipients.has(phone)) {
        selectedRecipients.delete(phone);
        if (row) row.classList.remove('bg-primary-subtle', 'text-primary-emphasis', 'text-body');
    } else {
        selectedRecipients.add(phone);
        if (row) row.classList.add('bg-primary-subtle', 'text-primary-emphasis');
    }
    updateSelectionCount();
}

function toggleSelectAll() {
    const checkbox = document.getElementById('select-all-leads');
    const visibleCheckboxes = document.querySelectorAll('#bulk-recipients-list .recipient-checkbox');

    // 1. Update visible items immediately for UI feedback
    visibleCheckboxes.forEach(cb => {
        const phone = cb.value;
        const row = cb.closest('.bulk-recipient-item');
        cb.checked = checkbox.checked;
        if (row) {
            if (checkbox.checked) row.classList.add('bg-primary-subtle', 'text-primary-emphasis');
            else row.classList.remove('bg-primary-subtle', 'text-primary-emphasis');
        }
    });

    // 2. Update selectedRecipients Set for ALL filtered leads (even those not yet visible)
    if (checkbox.checked) {
        currentBulkLeads.forEach(lead => selectedRecipients.add(lead.phone));
    } else {
        currentBulkLeads.forEach(lead => selectedRecipients.delete(lead.phone));
    }

    updateSelectionCount();
}

function clearSelection() {
    selectedRecipients.clear();
    document.getElementById('select-all-leads').checked = false;

    // Optimization: Update visible checkboxes and classes directly
    const visibleCheckboxes = document.querySelectorAll('#bulk-recipients-list .recipient-checkbox');
    visibleCheckboxes.forEach(cb => {
        cb.checked = false;
        const row = cb.closest('.bulk-recipient-item');
        if (row) row.classList.remove('bg-primary-subtle', 'text-primary-emphasis');
    });

    updateSelectionCount();
}

function updateSelectionCount() {
    const count = selectedRecipients.size;
    document.getElementById('selected-count').textContent = count;
    document.getElementById('send-count').textContent = count;

    // Enable/disable send button
    const sendBtn = document.getElementById('send-bulk-btn');
    sendBtn.disabled = count === 0;
}

function passesFilters(lead, filterStatus, searchTerm) {
    // Status filter
    if (filterStatus === 'completed' && !lead.completed) return false;
    if (filterStatus === 'incomplete' && lead.completed) return false;

    // Search filter
    if (searchTerm && !lead.name?.toLowerCase().includes(searchTerm) &&
        !lead.phone?.includes(searchTerm)) {
        return false;
    }

    return true;
}

const filterLeadsDebounced = debounce(function () {
    const filterStatus = document.getElementById('filter-status').value;
    const searchTerm = document.getElementById('search-leads').value.toLowerCase();

    currentBulkLeads = allLeadsForBulk.filter(lead => passesFilters(lead, filterStatus, searchTerm));
    displayedLeadsCount = 20; // Reset pagination on filter
    renderBulkRecipients();
}, 300);

function filterLeads() {
    filterLeadsDebounced();
}

function updateCharCount() {
    const text = document.getElementById('bulk-message-text').value;
    // If manual edit detected and was template, warn or clear?
    // For now, if user edits, we *could* clear selectedTemplate to fallback to text.
    // But let's assume if they edit they want to modify the text message (which is only possible if they DON'T use the template API)
    // OR they are just previewing.
    // To be safe: If content changes significantly from template text, we should probably nullify selectedTemplate?
    // But checking exact match is hard if placeholders.

    // Simplification: We add an "oninput" listener to the textarea elsewhere to clear selectedTemplate if user types?
    // Or we just check logic in sendBulkMessages.

    // Let's add the input listener dynamically or in HTML.
    // But for now, just update char count.
    document.getElementById('char-count').textContent = `${text.length} characters`;
}

// Add listener to clear template selection on manual edit
document.getElementById('bulk-message-text').addEventListener('input', function () {
    if (selectedTemplate) {
        // Check if user is trying to edit a template
        // Ideally we should warn "Editing this will switch to standard text message"
        // For now, let's silently switch to text mode or keep it as template?
        // If we keep it as template, the EDITS WON'T BE SENT because we send templateName.
        // So we MUST clear selectedTemplate if they edit.

        selectedTemplate = null;
        this.style.borderColor = '';
        this.style.backgroundColor = '';
        const badge = document.querySelector('.template-badge');
        if (badge) {
            badge.remove();
            if (window.toast) window.toast.info('Switched to Text Mode', 'Custom formatting will be sent as standard text.');
        }
    }
});

function updatePreview() {
    const text = document.getElementById('bulk-message-text').value;
    const personalize = document.getElementById('personalize-messages').checked;
    const previewEl = document.getElementById('preview-message');

    if (!text) {
        previewEl.innerHTML = '<em class="text-muted">Your message will appear here...</em>';
        return;
    }

    let previewText = text;
    if (personalize) {
        previewText = text
            .replace(/{name}/g, '<strong style="color: #00a884;">Atika</strong>')
            .replace(/{preferred_date}/g, '<strong style="color: #00a884;">Tomorrow</strong>')
            .replace(/{preferred_time}/g, '<strong style="color: #00a884;">10:00 AM - 12:00 PM</strong>');
    }

    previewEl.innerHTML = previewText.replace(/\n/g, '<br>');
}

async function showBulkTemplates() {
    const container = document.getElementById('templates-list');
    container.innerHTML = '<div class="text-center w-100 py-4"><div class="spinner-border text-primary" role="status"></div><p class="mt-2">Loading Meta templates...</p></div>';

    try {
        const response = await fetch('/api/templates');
        if (!response.ok) throw new Error('Failed to fetch templates');

        const data = await response.json();
        const templates = data.data || [];

        container.innerHTML = '';

        if (templates.length === 0) {
            container.innerHTML = '<div class="text-center w-100 py-4"><p>No approved templates found in your WhatsApp Business Account.</p></div>';
            return;
        }

        templates.forEach((template, index) => {
            const bodyComponent = template.components.find(c => c.type === 'BODY') || {};
            const bodyText = bodyComponent.text || 'No text content';

            const card = document.createElement('div');
            card.className = 'col-md-6';
            // Escape template data to safe JSON string for the onclick handler
            const templateJson = JSON.stringify(template).replace(/'/g, "\\'");

            card.innerHTML = `
                        <div class="card h-100 border hover-shadow bg-body-tertiary" style="cursor: pointer; transition: all 0.2s;">
                            <div class="card-body">
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <h6 class="card-title text-primary mb-0">
                                        <i class="bi bi-whatsapp me-1"></i> ${template.name}
                                    </h6>
                                    <span class="badge bg-success-subtle text-success border border-success-subtle" style="font-size: 0.7rem;">${template.status}</span>
                                </div>
                                <div class="mb-2">
                                     <small class="text-secondary me-2"><i class="bi bi-translate"></i> ${template.language}</small>
                                     <small class="text-secondary"><i class="bi bi-grid"></i> ${template.category}</small>
                                </div>
                                <p class="card-text small text-muted text-truncate-3" style="white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">${bodyText}</p>
                            </div>
                            <div class="card-footer bg-transparent border-0">
                                <button class="btn btn-sm btn-outline-primary w-100" onclick='useTemplate(${templateJson})'>
                                    <i class="bi bi-check-circle me-1"></i> Select Template
                                </button>
                            </div>
                        </div>
                    `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error fetching templates:', error);
        container.innerHTML = `<div class="text-center w-100 py-4 text-danger"><i class="bi bi-exclamation-triangle"></i> Failed to load templates: ${error.message}</div>`;
    }
}

function useTemplate(template) {
    console.log("Selected template:", template);
    selectedTemplate = template;

    const bodyComponent = template.components.find(c => c.type === 'BODY') || {};
    const bodyText = bodyComponent.text || '';

    const textArea = document.getElementById('bulk-message-text');
    textArea.value = bodyText; // Show for preview/context

    // Visual feedback that a template is active
    textArea.style.borderColor = '#00a884';
    textArea.style.backgroundColor = 'rgba(0, 168, 132, 0.05)';

    // Add a badge or indicator
    const label = document.querySelector('label[for="bulk-message-text"]') || textArea.previousElementSibling;
    if (label) {
        const existingBadge = label.querySelector('.template-badge');
        if (existingBadge) existingBadge.remove();

        label.innerHTML += ` <span class="template-badge badge bg-success ms-2"><i class="bi bi-check-all"></i> Template: ${template.name}</span>`;
    }

    updateCharCount();
    updatePreview();

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('templatesModal'));
    modal.hide();

    // Notify user
    if (window.toast) window.toast.success('Template Selected', `Using template: ${template.name}`);
}

function resetBulkForm() {
    selectedTemplate = null;
    document.getElementById('bulk-message-text').value = '';
    document.getElementById('bulk-message-text').style.borderColor = '';
    document.getElementById('bulk-message-text').style.backgroundColor = '';

    const label = document.querySelector('label[for="bulk-message-text"]'); // We need a more robust selector if label text changes
    // Revert label if needed or just remove badge. 
    // Simpler: find the badge and remove it
    const badge = document.querySelector('.template-badge');
    if (badge) badge.remove();

    clearSelection();
    updateCharCount();
    updatePreview();
}

function toggleScheduleTime() {
    const isScheduled = document.getElementById('send-scheduled').checked;
    const container = document.getElementById('bulk-schedule-time-container');
    const btnText = document.getElementById('send-btn-text');

    if (isScheduled) {
        container.style.display = 'block';
        btnText.textContent = 'Schedule for';
    } else {
        container.style.display = 'none';
        btnText.textContent = 'Send to';
    }
}

async function sendBulkMessages() {
    const message = document.getElementById('bulk-message-text').value.trim();

    if (!message) {
        alert('Please enter a message to send.');
        return;
    }

    if (selectedRecipients.size === 0) {
        alert('Please select at least one recipient.');
        return;
    }

    const isScheduled = document.getElementById('send-scheduled').checked;
    const personalize = document.getElementById('personalize-messages').checked;
    const addDelay = document.getElementById('add-delay').checked;

    // Handle scheduled sending
    if (isScheduled) {
        const scheduleTime = document.getElementById('bulk-schedule-time').value;
        if (!scheduleTime) {
            alert('Please select a schedule time.');
            return;
        }

        const scheduledDate = new Date(scheduleTime);
        if (scheduledDate <= new Date()) {
            alert('Schedule time must be in the future.');
            return;
        }

        if (!confirm(`Schedule this message for ${scheduledDate.toLocaleString()} to ${selectedRecipients.size} recipients?`)) {
            return;
        }

        try {
            const response = await fetch('/api/bulk-messages/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    recipients: Array.from(selectedRecipients),
                    scheduledTime: scheduleTime,
                    personalize,
                    addDelay
                })
            });

            if (response.ok) {
                alert('Bulk message scheduled successfully!');
                // Reset form
                document.getElementById('bulk-message-text').value = '';
                clearSelection();
                document.getElementById('send-now').checked = true;
                toggleScheduleTime();
                updateCharCount();
                updatePreview();
            } else {
                const error = await response.json();
                alert('Failed to schedule message: ' + (error.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error scheduling message:', error);
            alert('Failed to schedule message. Please try again.');
        }
        return;
    }

    // Handle immediate sending
    if (!confirm(`Are you sure you want to send this message to ${selectedRecipients.size} recipients?`)) {
        return;
    }

    // Create Campaign record
    let campaignId = null;
    try {
        const campaignName = `${selectedTemplate ? selectedTemplate.name : 'Bulk Text'} - ${new Date().toLocaleString()}`;
        const camRes = await fetch('/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: campaignName,
                type: selectedTemplate ? 'template' : 'text',
                content: message,
                templateName: selectedTemplate?.name,
                totalRecipients: selectedRecipients.size,
                status: 'sending'
            })
        });
        if (camRes.ok) {
            const campaignData = await camRes.json();
            campaignId = campaignData._id;
        }
    } catch (err) {
        console.error("Failed to create campaign record:", err);
    }

    // Show progress section
    const progressSection = document.getElementById('bulk-progress-section');
    progressSection.style.display = 'block';

    // Fix: Target only the content container for scrolling to prevent the entire UI (including sidebar) from shifting
    const contentContainer = document.getElementById('content');
    if (contentContainer) {
        // Small timeout to allow the browser to render the newly displayed section
        setTimeout(() => {
            const targetScroll = progressSection.offsetTop - 20;
            contentContainer.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });
        }, 100);
    }

    // Reset counters
    let sent = 0;
    let failed = 0;
    const total = selectedRecipients.size;

    document.getElementById('sent-count').textContent = '0';
    document.getElementById('failed-count').textContent = '0';
    document.getElementById('remaining-count').textContent = total;
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-bar').textContent = '0%';
    document.getElementById('bulk-log').innerHTML = '';

    // Disable send button
    document.getElementById('send-bulk-btn').disabled = true;

    // Get selected leads data
    const recipients = allLeadsForBulk.filter(lead => selectedRecipients.has(lead.phone));

    for (const lead of recipients) {
        let personalizedMessage = message;

        if (personalize) {
            personalizedMessage = message
                .replace(/{name}/g, lead.name || 'there')
                .replace(/{preferred_date}/g, lead.preferred_date || 'your requested date')
                .replace(/{preferred_time}/g, lead.preferred_time || 'your requested time');
        }

        try {
            let response;

            if (selectedTemplate) {
                const bodyComponent = selectedTemplate.components.find(c => c.type === 'BODY') || {};
                const bodyText = bodyComponent.text || '';

                const components = [];
                const bodyParams = [];

                // Heuristic: Map {{1}} to Name
                if (bodyText.includes('{{1}}')) {
                    bodyParams.push({
                        type: "text",
                        text: lead.name || "Valued Customer"
                    });
                }

                // Handle additional placeholders simplisticly to avoid errors
                const matches = bodyText.match(/{{(\d+)}}/g);
                if (matches && matches.length > bodyParams.length) {
                    const diff = matches.length - bodyParams.length;
                    for (let i = 0; i < diff; i++) {
                        // Map {{2}} to preferred_date if available, else dash
                        if (i === 0 && matches.length >= 2) {
                            bodyParams.push({ type: "text", text: lead.preferred_date || "soon" });
                        } else {
                            bodyParams.push({ type: "text", text: "-" });
                        }
                    }
                }

                if (bodyParams.length > 0) {
                    components.push({
                        type: "body",
                        parameters: bodyParams
                    });
                }

                response = await fetch('/api/bulk-send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: lead.phone,
                        templateName: selectedTemplate.name,
                        languageCode: selectedTemplate.language,
                        components: components,
                        campaignId: campaignId
                    })
                });

            } else {
                // Normal Text Message
                response = await fetch('/api/bulk-send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: lead.phone,
                        message: personalizedMessage,
                        campaignId: campaignId
                    })
                });
            }

            if (response.ok) {
                sent++;
                addLog('success', `✓ Sent to ${lead.name || 'Unknown'} (${formatPhone(lead.phone)})`);
            } else {
                const err = await response.json().catch(() => ({}));
                failed++;
                addLog('error', `✗ Failed to send to ${lead.name || 'Unknown'} (${formatPhone(lead.phone)}): ${err.error || 'Unknown error'}`);
            }
        } catch (error) {
            failed++;
            addLog('error', `✗ Error sending to ${lead.name || 'Unknown'}: ${error.message}`);
        }

        // Update progress
        const completed = sent + failed;
        const percentage = Math.round((completed / total) * 100);

        document.getElementById('sent-count').textContent = sent;
        document.getElementById('failed-count').textContent = failed;
        document.getElementById('remaining-count').textContent = total - completed;
        document.getElementById('progress-text').textContent = `${completed} / ${total}`;
        document.getElementById('progress-bar').style.width = `${percentage}%`;
        document.getElementById('progress-bar').textContent = `${percentage}%`;

        // Add delay if enabled
        if (addDelay && completed < total) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Update Campaign status to completed
    if (campaignId) {
        fetch(`/api/campaigns/${campaignId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' })
        }).catch(err => console.error("Failed to update campaign completion:", err));
    }

    // Re-enable send button
    document.getElementById('send-bulk-btn').disabled = false;

    // Final log
    addLog('info', `📊 Bulk send completed: ${sent} sent, ${failed} failed out of ${total} total`);

    if (failed === 0) {
        alert(`Success! All ${sent} messages were sent successfully! 🎉`);
    } else {
        alert(`Bulk send completed: ${sent} sent, ${failed} failed.`);
    }
}

async function loadScheduledMessages() {
    try {
        const response = await fetch('/api/bulk-messages/scheduled');
        const messages = await response.json();
        const container = document.getElementById('scheduled-messages-list');

        if (messages.length === 0) {
            container.innerHTML = `
                        <div class="text-center text-muted py-5">
                            <i class="bi bi-calendar-x" style="font-size: 3rem; opacity: 0.3;"></i>
                            <p class="mt-3">No scheduled messages</p>
                        </div>
                    `;
            return;
        }

        container.innerHTML = messages.map(msg => {
            const scheduledDate = new Date(msg.scheduledTime);
            const now = new Date();
            const isPast = scheduledDate < now;

            return `
                        <div class="p-3 border-bottom">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="flex-grow-1">
                                    <div class="d-flex align-items-center gap-2 mb-2">
                                        <i class="bi bi-clock text-info"></i>
                                        <strong>${scheduledDate.toLocaleString()}</strong>
                                        ${isPast ? '<span class="badge bg-warning text-dark">Pending Execution</span>' : '<span class="badge bg-info">Scheduled</span>'}
                                    </div>
                                    <div class="mb-2">
                                        <small class="text-muted">Recipients:</small>
                                        <span class="badge bg-primary">${msg.recipients.length}</span>
                                    </div>
                                    <div class="small text-muted" style="max-width: 600px; white-space: pre-wrap;">
                                        ${msg.message.substring(0, 150)}${msg.message.length > 150 ? '...' : ''}
                                    </div>
                                    <div class="mt-2">
                                        ${msg.personalize ? '<span class="badge bg-success-subtle text-success border border-success me-1"><i class="bi bi-person-badge"></i> Personalized</span>' : ''}
                                        ${msg.addDelay ? '<span class="badge bg-info-subtle text-info border border-info"><i class="bi bi-clock"></i> With Delay</span>' : ''}
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteScheduledMessage('${msg._id}')">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
        }).join('');
    } catch (error) {
        console.error('Error loading scheduled messages:', error);
        document.getElementById('scheduled-messages-list').innerHTML = `
                    <div class="text-center text-danger py-5">
                        <i class="bi bi-exclamation-triangle" style="font-size: 3rem;"></i>
                        <p class="mt-3">Failed to load scheduled messages</p>
                    </div>
                `;
    }
}

async function deleteScheduledMessage(id) {
    if (!confirm('Are you sure you want to delete this scheduled message?')) return;

    try {
        const response = await fetch(`/api/bulk-messages/scheduled/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadScheduledMessages();
        } else {
            alert('Failed to delete scheduled message');
        }
    } catch (error) {
        console.error('Error deleting scheduled message:', error);
        alert('Failed to delete scheduled message');
    }
}

function addLog(type, message) {
    const logContainer = document.getElementById('bulk-log');
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
        success: 'text-success',
        error: 'text-danger',
        info: 'text-primary'
    };

    const logEntry = document.createElement('div');
    logEntry.className = `${colors[type] || 'text-muted'} mb-1`;
    logEntry.textContent = `[${timestamp}] ${message}`;

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function resetBulkForm() {
    document.getElementById('bulk-message-text').value = '';
    document.getElementById('personalize-messages').checked = true;
    document.getElementById('add-delay').checked = true;
    clearSelection();
    document.getElementById('bulk-progress-section').style.display = 'none';
    updateCharCount();
    updatePreview();
}

// Load bulk recipients when showing bulk messaging tab
const originalShowContent = showContent;
showContent = function (contentId) {
    originalShowContent(contentId);
    if (contentId === 'bulk-messaging' && allLeadsForBulk.length === 0) {
        loadBulkRecipients();
    }
    if (contentId === 'flows') {
        fetchFlows();
    }
    if (contentId === 'campaigns') {
        loadCampaigns();
    }
};

// ========================================
// CAMPAIGNS FUNCTIONALITY
// ========================================

async function loadCampaigns() {
    const listBody = document.getElementById('campaign-list-body');
    const statsOverview = document.getElementById('campaign-stats-overview');

    try {
        const res = await fetch('/api/campaigns');
        const campaigns = await res.json();

        if (campaigns.length === 0) {
            listBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No campaigns found.</td></tr>';
            return;
        }

        // Overall Stats
        let totalSent = 0, totalDelivered = 0, totalRead = 0, totalReplied = 0;
        campaigns.forEach(c => {
            totalSent += c.sentCount || 0;
            totalDelivered += c.deliveredCount || 0;
            totalRead += c.readCount || 0;
            totalReplied += c.repliedCount || 0;
        });

        statsOverview.innerHTML = `
                    <div class="col-md-3">
                        <div class="stat-card">
                            <h6 class="text-secondary small text-uppercase fw-bold mb-1">Delivered</h6>
                            <h3 class="mb-0 fw-bold text-info">${totalDelivered}</h3>
                            <small class="text-muted">${totalSent > 0 ? Math.round(totalDelivered / totalSent * 100) : 0}% delivery rate</small>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-card">
                            <h6 class="text-secondary small text-uppercase fw-bold mb-1">Read</h6>
                            <h3 class="mb-0 fw-bold text-success">${totalRead}</h3>
                            <small class="text-muted">${totalDelivered > 0 ? Math.round(totalRead / totalDelivered * 100) : 0}% read rate</small>
                        </div>
                    </div>
                     <div class="col-md-3">
                        <div class="stat-card">
                            <h6 class="text-secondary small text-uppercase fw-bold mb-1">Replies</h6>
                            <h3 class="mb-0 fw-bold text-warning">${totalReplied}</h3>
                            <small class="text-muted">${totalRead > 0 ? Math.round(totalReplied / totalRead * 100) : 0}% response rate</small>
                        </div>
                    </div>
                     <div class="col-md-3">
                        <div class="stat-card">
                            <h6 class="text-secondary small text-uppercase fw-bold mb-1">Total Sent</h6>
                            <h3 class="mb-0 fw-bold">${totalSent}</h3>
                            <small class="text-muted">Across ${campaigns.length} campaigns</small>
                        </div>
                    </div>
                `;

        listBody.innerHTML = campaigns.map(c => {
            const progress = c.totalRecipients > 0 ? Math.round((c.sentCount / c.totalRecipients) * 100) : 0;
            const engagement = c.sentCount > 0 ? `
                        <div class="d-flex gap-2 small">
                            <span title="Delivered"><i class="bi bi-check2-all text-info"></i> ${c.deliveredCount}</span>
                            <span title="Read"><i class="bi bi-eye text-success"></i> ${c.readCount}</span>
                            <span title="Replied"><i class="bi bi-reply text-warning"></i> ${c.repliedCount}</span>
                        </div>
                    ` : '-';

            return `
                        <tr>
                            <td>
                                <div class="fw-bold text-truncate" style="max-width: 100%;" title="${c.name}">${c.name}</div>
                                <div class="small text-muted text-truncate">${c.type === 'template' ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">${c.templateName}</span>` : 'Text Message'}</div>
                            </td>
                            <td>
                                <span class="badge bg-${c.status === 'completed' ? 'success' : 'warning'}-subtle text-${c.status === 'completed' ? 'success' : 'warning'} border border-${c.status === 'completed' ? 'success' : 'warning'}-subtle">
                                    ${c.status.toUpperCase()}
                                </span>
                            </td>
                            <td>
                                <div class="d-flex align-items-center gap-2">
                                    <div class="progress flex-grow-1" style="height: 6px;">
                                        <div class="progress-bar" style="width: ${progress}%"></div>
                                    </div>
                                    <small>${progress}%</small>
                                </div>
                                <div class="x-small text-muted">${c.sentCount} / ${c.totalRecipients}</div>
                            </td>
                            <td>${engagement}</td>
                            <td><small>${new Date(c.createdAt).toLocaleDateString()}<br>${new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td>
                            <td>
                                <button class="btn btn-sm btn-outline-secondary" 
                                        data-bs-toggle="modal" 
                                        data-bs-target="#campaignDetailsModal" 
                                        onclick="viewCampaignDetails('${c._id}')">
                                    <i class="bi bi-info-circle"></i>
                                </button>
                            </td>
                        </tr>
                    `;
        }).join('');

    } catch (err) {
        console.error("Failed to load campaigns:", err);
        listBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-danger">Error loading campaigns.</td></tr>';
    }
}

// Listen for campaign updates via socket
socket.on('campaignUpdate', (data) => {
    console.log("Campaign update received:", data);
    const activeTab = document.querySelector('.page-content:not([style*="display: none"])');
    if (activeTab && activeTab.id === 'campaigns') {
        loadCampaigns(); // Refresh list if on campaigns tab
    }
});

let currentCampaignData = null;

async function viewCampaignDetails(id) {
    const modalEl = document.getElementById('campaignDetailsModal');
    if (!modalEl) {
        console.error("Modal element #campaignDetailsModal not found");
        if (typeof toast !== 'undefined') toast.error("UI Error", "Campaign details modal missing.");
        return;
    }

    const title = document.getElementById('campaignDetailsTitle');
    const subtitle = document.getElementById('campaignDetailsSubtitle');
    const stats = document.getElementById('campaignDetailsStats');
    const listBody = document.getElementById('campaign-recipients-body');

    title.textContent = "Loading...";
    subtitle.textContent = "Please wait while we fetch recipient details...";
    stats.innerHTML = '';
    listBody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border text-primary"></div></td></tr>';

    // Use getOrCreateInstance for robustness
    const bootstrapObj = window.bootstrap || (typeof bootstrap !== 'undefined' ? bootstrap : null);
    if (bootstrapObj && bootstrapObj.Modal) {
        const modal = bootstrapObj.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }

    try {
        const res = await fetch(`/api/campaigns/${id}`);
        const campaign = await res.json();
        currentCampaignData = campaign;

        title.textContent = campaign.name;
        document.getElementById('rename-campaign-btn').style.display = 'inline-block';
        subtitle.textContent = `${campaign.type === 'template' ? campaign.templateName : 'Text Message'} • Sent on ${new Date(campaign.createdAt).toLocaleString()}`;

        // Populate Stats
        stats.innerHTML = `
                    <div class="col-md-3">
                        <div class="p-3 bg-info bg-opacity-10 rounded-4 border border-info border-opacity-20 text-center">
                            <div class="text-info small fw-bold text-uppercase mb-1">Delivered</div>
                            <h4 class="mb-0 fw-bold">${campaign.deliveredCount}</h4>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="p-3 bg-success bg-opacity-10 rounded-4 border border-success border-opacity-20 text-center">
                            <div class="text-success small fw-bold text-uppercase mb-1">Read</div>
                            <h4 class="mb-0 fw-bold">${campaign.readCount}</h4>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="p-3 bg-warning bg-opacity-10 rounded-4 border border-warning border-opacity-20 text-center">
                            <div class="text-warning small fw-bold text-uppercase mb-1">Replied</div>
                            <h4 class="mb-0 fw-bold">${campaign.repliedCount}</h4>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="p-3 bg-danger bg-opacity-10 rounded-4 border border-danger border-opacity-20 text-center">
                            <div class="text-danger small fw-bold text-uppercase mb-1">Failed</div>
                            <h4 class="mb-0 fw-bold">${campaign.failedCount}</h4>
                        </div>
                    </div>
                `;

        renderCampaignRecipients(campaign.messages);

    } catch (err) {
        console.error("Error fetching campaign details:", err);
        title.textContent = "Error";
        subtitle.textContent = "Failed to load campaign details.";
        listBody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-danger">Failed to load data.</td></tr>';
    }
}

function renderCampaignRecipients(messages) {
    const listBody = document.getElementById('campaign-recipients-body');
    if (!messages || messages.length === 0) {
        listBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No recipients found for this campaign.</td></tr>';
        return;
    }

    listBody.innerHTML = messages.map(m => {
        // Try to find lead name from global leads list
        const lead = (typeof allLeads !== 'undefined' ? allLeads : []).find(l => normalizePhone(l.phone) === normalizePhone(m.recipient));
        const displayName = lead && lead.name ? lead.name : m.recipient;
        const displayPhone = lead ? m.recipient : '';

        let statusBadge = '';
        switch (m.status) {
            case 'read':
                statusBadge = '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-20 px-3 rounded-pill"><i class="bi bi-eye-fill me-1"></i> READ</span>';
                break;
            case 'delivered':
                statusBadge = '<span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-20 px-3 rounded-pill"><i class="bi bi-check2-all me-1"></i> DELIVERED</span>';
                break;
            case 'sent':
                statusBadge = '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-20 px-3 rounded-pill"><i class="bi bi-send-fill me-1"></i> SENT</span>';
                break;
            case 'failed':
                statusBadge = '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-20 px-3 rounded-pill"><i class="bi bi-exclamation-circle-fill me-1"></i> FAILED</span>';
                break;
            default:
                statusBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-20 px-3 rounded-pill">${m.status.toUpperCase()}</span>`;
        }

        const replyBadge = m.replied
            ? '<span class="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-20 px-3 rounded-pill"><i class="bi bi-reply-all-fill me-1"></i> REPLIED</span>'
            : '<span class="text-muted small opacity-50">No reply</span>';

        return `
                    <tr class="recipient-row">
                        <td>
                            <div class="d-flex align-items-center gap-2" style="max-width: 100%;">
                                <div class="avatar-sm rounded-circle bg-secondary bg-opacity-10 d-flex align-items-center justify-content-center text-secondary small fw-bold flex-shrink-0" style="width: 32px; height: 32px;">
                                    ${displayName.charAt(0).toUpperCase()}
                                </div>
                                <div class="overflow-hidden">
                                    <div class="fw-bold text-main text-truncate" title="${displayName}">${displayName}</div>
                                    <div class="x-small text-muted text-truncate" title="${displayPhone || m.messageId || 'N/A'}">${displayPhone || m.messageId || 'N/A'}</div>
                                </div>
                            </div>
                        </td>
                        <td>${statusBadge}</td>
                        <td>${replyBadge}</td>
                        <td>
                            <div class="small text-danger text-wrap" style="max-width: 200px;" title="${m.error || ''}">
                                ${m.error || '<span class="text-muted opacity-25">-</span>'}
                            </div>
                        </td>
                        <td class="text-end" style="width: 80px;">
                            <button class="btn btn-sm btn-action rounded-pill px-3 shadow-sm" onclick="jumpToChat('${m.recipient}')" style="background: var(--primary-color); color: white; border: none;" title="Reply">
                                <i class="bi bi-chat-dots-fill"></i>
                            </button>
                        </td>
                    </tr>
                `;
    }).join('');
}

function filterCampaignRecipients() {
    if (!currentCampaignData) return;

    const searchTerm = document.getElementById('campaign-recipient-search').value.toLowerCase();
    const statusFilter = document.getElementById('campaign-status-filter').value;

    const filtered = currentCampaignData.messages.filter(m => {
        const matchesSearch = m.recipient.toLowerCase().includes(searchTerm);
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'replied' ? m.replied : m.status === statusFilter);
        return matchesSearch && matchesStatus;
    });

    renderCampaignRecipients(filtered);
}

async function jumpToChat(phone) {
    const normalizedPhone = normalizePhone(phone);

    // Find the lead name first for breadcrumbs/header
    const lead = (typeof allLeads !== 'undefined' ? allLeads : []).find(l => normalizePhone(l.phone) === normalizedPhone);
    const name = lead ? lead.name : phone;

    // Close details modal
    const modalEl = document.getElementById('campaignDetailsModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    // Switch to Live Chat tab
    showContent('live-chat');

    // Give the UI a moment to switch tabs then open chat
    setTimeout(() => {
        if (typeof openChat === 'function') {
            openChat(phone, name);
        } else {
            console.error("openChat function not found");
            toast.error("Error", "Could not open chat interface.");
        }
    }, 300);
}

async function renameCampaign() {
    if (!currentCampaignData) return;

    const oldName = currentCampaignData.name;
    const newName = prompt("Enter new name for this campaign:", oldName);

    if (!newName || newName === oldName) return;

    try {
        const res = await fetch(`/api/campaigns/${currentCampaignData._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });

        if (res.ok) {
            const updated = await res.json();
            currentCampaignData.name = updated.name;
            document.getElementById('campaignDetailsTitle').textContent = updated.name;

            if (typeof toast !== 'undefined') toast.success("Success", "Campaign renamed successfully");

            // Refresh the background list
            loadCampaigns();
        } else {
            throw new Error("Failed to update name");
        }
    } catch (err) {
        console.error("Rename failed:", err);
        if (typeof toast !== 'undefined') toast.error("Error", "Failed to rename campaign.");
    }
}


// ========================================
// END BULK MESSAGING FUNCTIONALITY
// ========================================

// ========================================
// ========================================
// FLOW BUILDER FUNCTIONALITY
// ========================================

let currentFlowId = null;
let currentFlowNodes = [];
let currentFlowConnections = [];
let selectedNodeId = null;
let nodeIdCounter = 0;

// Drag and drop state
let isDragging = false;
let draggedNode = null;
let dragOffset = { x: 0, y: 0 };

// Connection state
let isConnecting = false;
let connectionStart = null;

// Current Flow Settings (for modal)
let currentFlowSettings = {
    name: '',
    description: '',
    trigger: '',
    triggerType: 'contains',
    active: true,
    schedule: null,
    recipientConfig: { audienceType: 'all', phones: [] }
};

// Load all advanced flows
async function loadAdvancedFlows() {
    try {
        const response = await fetch('/api/advanced-flows');
        const flows = await response.json();
        renderAdvancedFlows(flows);
    } catch (error) {
        console.error('Error loading flows:', error);
    }
}

// Render flows as cards
function renderAdvancedFlows(flows) {
    const container = document.getElementById('advanced-flows-container');
    container.innerHTML = '';

    if (flows.length === 0) {
        container.innerHTML = `
                    <div class="col-12">
                        <div class="empty-flows-placeholder">
                            <i class="bi bi-diagram-3" style="font-size: 5rem; opacity: 0.2; color: var(--primary-color);"></i>
                            <h3 class="fw-bold mt-4">No Advanced Flows Found</h3>
                            <p class="text-secondary mx-auto mb-4" style="max-width: 500px;">
                                You haven't created any complex automation journeys yet. 
                                Build multi-step workflows with buttons, lists, and conditions to automate your customer interactions efficiently.
                            </p>
                            <button class="btn btn-primary rounded-pill px-5 py-3 shadow" onclick="createNewFlow()">
                                <i class="bi bi-magic me-2"></i>Create Your First Journey
                            </button>
                        </div>
                    </div>
                `;
        return;
    }

    flows.forEach(flow => {
        const card = document.createElement('div');
        card.className = 'col-md-6 col-lg-4';
        const deliveryRate = flow.stats.sent > 0 ? ((flow.stats.delivered / flow.stats.sent) * 100).toFixed(1) : '0.0';

        card.innerHTML = `
                    <div class="flow-builder-card" onclick="editFlow('${flow._id}')">
                        <div class="d-flex justify-content-between align-items-start mb-4">
                            <div class="d-flex align-items-center gap-3">
                                <div class="bg-primary bg-opacity-10 p-3 rounded-4">
                                    <i class="bi bi-diagram-3-fill text-primary fs-4"></i>
                                </div>
                                <div>
                                    <h5 class="mb-1 fw-bold">${flow.name}</h5>
                                    <span class="flow-trigger-pill">
                                        <i class="bi bi-lightning-charge-fill"></i> ${flow.trigger}
                                    </span>
                                </div>
                            </div>
                            <span class="flow-status-badge ${flow.active ? 'status-active' : 'status-inactive'}">
                                ${flow.active ? 'Active' : 'Paused'}
                            </span>
                        </div>
                        
                        <p class="text-secondary small mb-4" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 40px;">
                            ${flow.description || 'No description provided for this automation flow.'}
                        </p>
                        
                        <div class="row g-2 mb-4">
                            <div class="col-4">
                                <div class="flow-stat-pill">
                                    <span class="flow-stat-value">${flow.stats.sent || 0}</span>
                                    <span class="flow-stat-label">Sent</span>
                                </div>
                            </div>
                            <div class="col-4">
                                <div class="flow-stat-pill">
                                    <span class="flow-stat-value">${deliveryRate}%</span>
                                    <span class="flow-stat-label">Rate</span>
                                </div>
                            </div>
                            <div class="col-4">
                                <div class="flow-stat-pill">
                                    <span class="flow-stat-value">${flow.stats.clicked || 0}</span>
                                    <span class="flow-stat-label">Clicks</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="d-flex gap-2">
                            <button class="btn btn-primary btn-sm rounded-pill flex-grow-1 py-2" onclick="event.stopPropagation(); editFlow('${flow._id}')">
                                <i class="bi bi-pencil-square me-1"></i> Edit
                            </button>
                            <button class="btn btn-outline-secondary btn-sm rounded-circle" style="width: 36px; height: 36px;" onclick="event.stopPropagation(); toggleFlowActive('${flow._id}')" title="${flow.active ? 'Pause' : 'Resume'}">
                                <i class="bi bi-${flow.active ? 'pause' : 'play'}-fill"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm rounded-circle" style="width: 36px; height: 36px;" onclick="event.stopPropagation(); deleteAdvancedFlow('${flow._id}')" title="Delete">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
        container.appendChild(card);
    });
}

// Create new flow
// Edit existing flow
// Edit existing flow
async function editFlow(flowId) {
    window.location.href = `/flow-builder-v2.html?id=${flowId}`;
}

// Back to flow list
function backToFlowList() {
    document.getElementById('flow-editor-view').style.display = 'none';
    document.getElementById('flow-list-view').style.display = 'block';
    loadAdvancedFlows();
}

// Settings Modal Functions

function updateRepeatSelect(value) {
    document.getElementById('flow-schedule-repeat').value = value;
}

async function openFlowSettings() {
    // Populate leads
    const recipientList = document.getElementById('flow-recipient-list');
    if (recipientList.options.length <= 1) { // Load if only default is there
        try {
            const res = await fetch('/api/leads');
            const leads = await res.json();
            leads.forEach(lead => {
                const opt = document.createElement('option');
                opt.value = lead.phone;
                opt.text = `${lead.name || 'Unknown'} (${lead.phone})`;
                recipientList.add(opt);
            });
        } catch (e) {
            console.error("Failed to load leads", e);
        }
    }

    // Select active options if editing
    if (window.tempRecipientConfig) {
        const config = window.tempRecipientConfig;
        const opts = recipientList.options;
        for (let i = 0; i < opts.length; i++) {
            if (config.audienceType === 'all' && opts[i].value === 'all') {
                opts[i].selected = true;
            } else if (config.phones && config.phones.includes(opts[i].value)) {
                opts[i].selected = true;
            } else {
                opts[i].selected = false;
            }
        }
        window.tempRecipientConfig = null; // Clear
    }

    // Toggle schedule fields based on current selection - REMOVED since only scheduled flows are supported now
    // const trgType = document.getElementById('flow-trigger-type'); 
    // const schedOptions = document.getElementById('schedule-options');
    // const trgInput = document.getElementById('flow-trigger');

    // Logic removed for pure scheduled flows

    // Logic removed for pure scheduled flows

    const modal = new bootstrap.Modal(document.getElementById('flowSettingsModal'));
    modal.show();
}

function applyFlowSettings() {
    const name = document.getElementById('flow-name').value || 'Untitled Flow';
    document.getElementById('editor-flow-name-display').textContent = name;

    // Hide modal
    const modalEl = document.getElementById('flowSettingsModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
}

// Create new flow
function createNewFlow() {
    window.location.href = '/flow-builder-v2.html';
}

// ... (existing editFlow logic, omitting to save tokens, assuming it handles missing IDs gracefully or I should update it separately? 
// editFlow tries to set values to elements that might be missing: flow-trigger, flow-trigger-type. 
// I should probably update editFlow too, or let it fail silently/check if element exists. 
// For now, let's just focus on saveCurrentFlow.
// Actually, I'll update editFlow in a separate call if needed, but let's do safe save first)
// Oops, I can't update createNewFlow in the same replace block if the line ranges don't match or are far apart. 
// The user instruction said "Updated saveCurrentFlow". 
// Wait, looking at line numbers: createNewFlow ends around 1797. saveCurrentFlow starts around 1922. 
// I should do two separate edits or one big one if I include everything in between. 
// It's safer to do separate edits. I will stick to saveCurrentFlow logic here.

// Save current flow
async function saveCurrentFlow() {
    if (currentFlowNodes.length === 0) {
        alert('Cannot save an empty flow.');
        return;
    }

    const name = document.getElementById('flow-name').value.trim();
    // const trigger = document.getElementById('flow-trigger').value.trim(); // Removed
    // const triggerType = document.getElementById('flow-trigger-type').value; // Removed

    if (!name) {
        alert('Please provide a flow name in Settings.');
        openFlowSettings();
        return;
    }

    // Validating Schedule Time
    const scheduleTime = document.getElementById('flow-schedule-time').value;
    if (!scheduleTime) {
        alert('Please provide schedule time.');
        openFlowSettings();
        return;
    }

    const recipientSelect = document.getElementById('flow-recipient-list');
    let recipientConfig = { audienceType: 'all', phones: [] };
    const selectedOptions = Array.from(recipientSelect.selectedOptions).map(opt => opt.value);

    if (selectedOptions.includes('all') || selectedOptions.length === 0) {
        recipientConfig.audienceType = 'all';
    } else {
        recipientConfig.audienceType = 'specific';
        recipientConfig.phones = selectedOptions;
    }

    const flowData = {
        name,
        description: document.getElementById('flow-description').value.trim(),
        trigger: 'Scheduled',
        triggerType: 'scheduled',
        active: document.getElementById('flow-active').checked,
        recipientConfig,
        nodes: currentFlowNodes,
        connections: currentFlowConnections,
        schedule: {
            time: new Date(scheduleTime),
            repeat: document.getElementById('flow-schedule-repeat').value,
            nextRun: new Date(scheduleTime)
        }
    };

    // Previous trigger checks removed

    try {
        let response;
        if (currentFlowId) {
            response = await fetch(`/api/advanced-flows/${currentFlowId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(flowData)
            });
        } else {
            response = await fetch('/api/advanced-flows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(flowData)
            });
        }

        if (response.ok) {
            const savedFlow = await response.json();
            currentFlowId = savedFlow._id;
            alert('Flow saved successfully!');
        } else {
            const err = await response.json();
            alert('Failed to save flow: ' + (err.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving flow:', error);
        alert('Failed to save flow.');
    }
}

// Test Flow
async function testCurrentFlow() {
    const phone = prompt('Enter phone number for testing (e.g. 1234567890):');
    if (!phone) return;

    const name = document.getElementById('flow-name').value || 'Test Flow';
    const trigger = document.getElementById('flow-trigger').value || 'test';

    // Build temporary flow data
    const flowData = {
        name,
        trigger,
        nodes: currentFlowNodes,
        connections: currentFlowConnections,
        active: true
    };

    try {
        const res = await fetch('/api/test-flow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, flowData })
        });

        if (res.ok) {
            alert('Test message sent! Check your WhatsApp.');
        } else {
            const err = await res.json();
            alert('Test failed: ' + (err.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Error testing flow: ' + e.message);
    }
}

// Delete flow
async function deleteAdvancedFlow(flowId) {
    if (!confirm('Are you sure you want to delete this flow? This cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/advanced-flows/${flowId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadAdvancedFlows();
        } else {
            alert('Failed to delete flow');
        }
    } catch (error) {
        console.error('Error deleting flow:', error);
        alert('Failed to delete flow');
    }
}

// Toggle flow active status
async function toggleFlowActive(flowId) {
    try {
        const response = await fetch(`/api/advanced-flows/${flowId}/toggle`, {
            method: 'PATCH'
        });

        if (response.ok) {
            loadAdvancedFlows();
        } else {
            alert('Failed to toggle flow status');
        }
    } catch (error) {
        console.error('Error toggling flow:', error);
    }
}

// Clear Canvas
function clearCanvas() {
    if (currentFlowNodes.length > 0 && !confirm('Clear all nodes? (Start node will be preserved)')) return;

    // Preserve start nodes
    const startNodes = currentFlowNodes.filter(n => n.type === 'start');

    // Remove connections involving non-start nodes
    const startNodeIds = new Set(startNodes.map(n => n.id));
    currentFlowConnections = currentFlowConnections.filter(c =>
        startNodeIds.has(c.source) && startNodeIds.has(c.target)
    );

    // Keep only start nodes
    currentFlowNodes = startNodes;

    renderCanvas();
    document.getElementById('node-properties').innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="bi bi-cursor" style="font-size: 2rem; opacity: 0.3;"></i>
                    <p class="mt-2 small">Select a node to edit its properties</p>
                </div>
            `;
}

// Add node to canvas
function addNode(type) {
    const nodeId = `node_${nodeIdCounter++}`;
    const node = {
        id: nodeId,
        type,
        position: {
            x: 50 + (currentFlowNodes.length * 20) % 300,
            y: 50 + (currentFlowNodes.length * 20) % 300
        },
        data: getDefaultNodeData(type)
    };

    currentFlowNodes.push(node);
    renderCanvas();
    selectNode(nodeId);
}

// Get default data for node type
function getDefaultNodeData(type) {
    const defaults = {
        start: { text: 'Flow Start' },
        message: { text: 'Hello! How can I help you?' },
        buttons: {
            text: 'Choose an option:',
            buttons: [{
                text: 'Option 1',
                reply: 'You selected Option 1!',
                type: 'reply'
            }]
        },
        list: {
            text: 'Select from list:',
            title: 'Menu',
            listItems: [{ title: 'Item 1', description: 'Description' }]
        },
        image: { mediaUrl: '', caption: '' },
        video: { mediaUrl: '', caption: '' },
        document: { mediaUrl: '', caption: '', filename: 'document.pdf' },
        delay: { delaySeconds: 2 },
        condition: { variable: 'lastResponse', condition: 'contains', value: 'yes' }
    };
    return defaults[type] || {};
}

// Remove Node
function removeNode(nodeId) {
    // Prevent deletion of start node
    const node = currentFlowNodes.find(n => n.id === nodeId);
    if (node && node.type === 'start') {
        alert('Cannot delete the start node. Every flow must have an entry point.');
        return;
    }

    currentFlowNodes = currentFlowNodes.filter(n => n.id !== nodeId);
    currentFlowConnections = currentFlowConnections.filter(c => c.source !== nodeId && c.target !== nodeId);
    renderCanvas();
    document.getElementById('node-properties').innerHTML = `
                 <div class="text-center text-muted py-5">
                    <i class="bi bi-cursor" style="font-size: 2rem; opacity: 0.3;"></i>
                    <p class="mt-2 small">Select a node to edit its properties</p>
                </div>
             `;
}

// Render entire canvas
function renderCanvas() {
    const canvas = document.getElementById('flow-canvas');
    const placeholder = document.getElementById('canvas-placeholder');

    // Clean up existing nodes (NOT SVG connections)
    canvas.querySelectorAll('.flow-node').forEach(el => el.remove());

    if (currentFlowNodes.length === 0) {
        placeholder.style.display = 'block';
        // Also clear connections visually if any
        document.getElementById('connections-svg').innerHTML = `
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                            <polygon points="0 0, 10 3, 0 6" fill="#2196F3" />
                        </marker>
                    </defs>
                `;
        return;
    }

    placeholder.style.display = 'none';

    // Render nodes
    currentFlowNodes.forEach(node => {
        const nodeElement = createNodeElement(node);
        canvas.appendChild(nodeElement);
    });

    // Render connections
    renderConnections();
}

// Create node DOM element with drag-and-drop
function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'flow-node';
    if (selectedNodeId === node.id) {
        div.classList.add('selected');
    }
    div.id = node.id;
    div.style.left = `${node.position.x}px`;
    div.style.top = `${node.position.y}px`;

    const icons = {
        start: 'bi-play-fill',
        message: 'bi-chat-text',
        buttons: 'bi-ui-checks',
        list: 'bi-list-ul',
        image: 'bi-image',
        video: 'bi-play-btn',
        document: 'bi-file-earmark-pdf',
        delay: 'bi-clock',
        condition: 'bi-shuffle'
    };

    const colors = {
        start: '#4caf50',
        message: '#2196f3',
        buttons: '#00a884',
        list: '#9c27b0',
        image: '#ff9800',
        video: '#e91e63',
        document: '#00bcd4',
        delay: '#607d8b',
        condition: '#f44336'
    };

    const color = colors[node.type] || '#999';

    div.innerHTML = `
                <div class="node-header">
                    <div class="node-type" style="color: ${color};">
                        <i class="bi ${icons[node.type]}"></i>
                        <span>${node.type.charAt(0).toUpperCase() + node.type.slice(1)}</span>
                    </div>
                    ${node.type !== 'start' ? `<button class="btn btn-sm btn-outline-danger" onclick="removeNode('${node.id}'); event.stopPropagation();" style="padding: 2px 8px;">
                        <i class="bi bi-x"></i>
                    </button>` : ''}
                </div>
                <div class="node-content">
                    ${getNodePreview(node)}
                </div>
                <div class="connection-point input" data-node="${node.id}" data-type="input"></div>
                <div class="connection-point output" data-node="${node.id}" data-type="output"></div>
            `;

    // Drag events
    div.addEventListener('mousedown', (e) => handleNodeMouseDown(e, node));
    div.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(node.id);
    });

    // Connection point events
    const outputPoint = div.querySelector('.connection-point.output');
    outputPoint.addEventListener('click', (e) => {
        e.stopPropagation();
        startConnection(node.id, outputPoint);
    });

    const inputPoint = div.querySelector('.connection-point.input');
    inputPoint.addEventListener('click', (e) => {
        e.stopPropagation();
        endConnection(node.id, inputPoint);
    });

    return div;
}

// Get node preview content
function getNodePreview(node) {
    if (node.type === 'message') {
        return (node.data.text || 'Empty message').substring(0, 30) + '...';
    } else if (node.type === 'buttons') {
        const count = node.data.buttons?.length || 0;
        return `${node.data.text || 'Choose option'}<br><small>${count} button(s)</small>`;
    } else if (node.type === 'list') {
        const count = node.data.listItems?.length || 0;
        return `${node.data.text || 'List'}<br><small>${count} item(s)</small>`;
    } else if (node.type === 'image') {
        return `<i class="bi bi-image"></i> ${node.data.caption || 'Image'}`;
    } else if (node.type === 'video') {
        return `<i class="bi bi-camera-video"></i> ${node.data.caption || 'Video'}`;
    } else if (node.type === 'document') {
        return `<i class="bi bi-file-text"></i> ${node.data.filename || 'Doc'}`;
    } else if (node.type === 'delay') {
        return `Wait ${node.data.delaySeconds || 0}s`;
    } else if (node.type === 'start') {
        return 'Flow entry point';
    } else if (node.type === 'condition') {
        return `If ${node.data.variable} ${node.data.condition} ${node.data.value || ''}`;
    }
    return '';
}

// Handle node mouse down for dragging
function handleNodeMouseDown(e, node) {
    if (e.target.closest('.connection-point') || e.target.closest('button')) {
        return; // Don't drag if clicking connection points or buttons
    }

    isDragging = true;
    draggedNode = node;

    const canvas = document.getElementById('flow-canvas');
    const canvasRect = canvas.getBoundingClientRect();

    dragOffset = {
        x: e.clientX - canvasRect.left - node.position.x - canvas.scrollLeft,
        y: e.clientY - canvasRect.top - node.position.y - canvas.scrollTop
    };

    document.getElementById(node.id).classList.add('dragging');
    e.preventDefault();
}

// Optimized drag with requestAnimationFrame for smooth performance
let dragAnimationFrame = null;
let lastMousePosition = { x: 0, y: 0 };

// Global mouse move for dragging - optimized
document.addEventListener('mousemove', (e) => {
    if (!isDragging || !draggedNode) return;

    // Store mouse position
    lastMousePosition.x = e.clientX;
    lastMousePosition.y = e.clientY;

    // Cancel previous animation frame if exists
    if (dragAnimationFrame) {
        cancelAnimationFrame(dragAnimationFrame);
    }

    // Use requestAnimationFrame for smooth updates
    dragAnimationFrame = requestAnimationFrame(() => {
        const canvas = document.getElementById('flow-canvas');
        const canvasRect = canvas.getBoundingClientRect();

        const newX = lastMousePosition.x - canvasRect.left - dragOffset.x + canvas.scrollLeft;
        const newY = lastMousePosition.y - canvasRect.top - dragOffset.y + canvas.scrollTop;

        draggedNode.position.x = Math.max(0, newX);
        draggedNode.position.y = Math.max(0, newY);

        const nodeElement = document.getElementById(draggedNode.id);
        if (nodeElement) {
            nodeElement.style.left = `${draggedNode.position.x}px`;
            nodeElement.style.top = `${draggedNode.position.y}px`;
        }

        // Only update connections every few frames for better performance
        renderConnections();
    });
});

// Global mouse up to stop dragging
document.addEventListener('mouseup', () => {
    if (isDragging && draggedNode) {
        const el = document.getElementById(draggedNode.id);
        if (el) el.classList.remove('dragging');
    }
    isDragging = false;
    draggedNode = null;

    // Cancel any pending animation frame
    if (dragAnimationFrame) {
        cancelAnimationFrame(dragAnimationFrame);
        dragAnimationFrame = null;
    }
});

// Start creating a connection
function startConnection(nodeId, element) {
    if (isConnecting) {
        // If already connecting, cancel
        isConnecting = false;
        connectionStart = null;
        document.querySelectorAll('.connection-point.connecting').forEach(el => {
            el.classList.remove('connecting');
        });
        return;
    }

    isConnecting = true;
    connectionStart = nodeId;
    element.classList.add('connecting');
}

// End creating a connection
function endConnection(nodeId, element) {
    if (!isConnecting || !connectionStart) return;

    if (connectionStart === nodeId) {
        isConnecting = false;
        connectionStart = null;
        document.querySelectorAll('.connection-point.connecting').forEach(el => {
            el.classList.remove('connecting');
        });
        return;
    }

    // Check if connection already exists
    const exists = currentFlowConnections.find(c =>
        c.source === connectionStart && c.target === nodeId
    );

    if (!exists) {
        currentFlowConnections.push({
            id: `conn_${currentFlowConnections.length}_${Date.now()}`,
            source: connectionStart,
            target: nodeId
        });
        renderConnections();
    }

    isConnecting = false;
    connectionStart = null;
    document.querySelectorAll('.connection-point.connecting').forEach(el => {
        el.classList.remove('connecting');
    });
}

// Render SVG connections
function renderConnections() {
    const svg = document.getElementById('connections-svg');

    svg.innerHTML = `
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                        <polygon points="0 0, 10 3, 0 6" fill="#2196F3" />
                    </marker>
                </defs>
            `;

    currentFlowConnections.forEach(conn => {
        const sourceNode = currentFlowNodes.find(n => n.id === conn.source);
        const targetNode = currentFlowNodes.find(n => n.id === conn.target);

        if (!sourceNode || !targetNode) return;

        const sourceEl = document.getElementById(sourceNode.id);
        const targetEl = document.getElementById(targetNode.id);

        if (!sourceEl || !targetEl) return;

        const sourceRect = { width: sourceEl.offsetWidth, height: sourceEl.offsetHeight };
        const targetRect = { width: targetEl.offsetWidth, height: targetEl.offsetHeight };

        // Calculate connection points (center bottom of source, center top of target)
        const x1 = sourceNode.position.x + (sourceRect.width / 2);
        const y1 = sourceNode.position.y + sourceRect.height;
        const x2 = targetNode.position.x + (targetRect.width / 2);
        const y2 = targetNode.position.y;

        // Create curved path
        const controlPointOffset = 50;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${x1} ${y1} C ${x1} ${y1 + controlPointOffset}, ${x2} ${y2 - controlPointOffset}, ${x2} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('class', 'connection-line');
        path.style.cursor = 'pointer';

        // Make path clickable for deletion
        path.onclick = (e) => {
            if (confirm('Delete this connection?')) {
                currentFlowConnections = currentFlowConnections.filter(c => c.id !== conn.id);
                renderConnections();
            }
        };

        svg.appendChild(path);
    });
}

// Select node
function selectNode(nodeId) {
    selectedNodeId = nodeId;
    document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('selected'));
    const el = document.getElementById(nodeId);
    if (el) el.classList.add('selected');

    const node = currentFlowNodes.find(n => n.id === nodeId);
    if (node) {
        showNodeProperties(node);
    }
}

// Show node properties editor
function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
}

function showNodeProperties(node) {
    const panel = document.getElementById('node-properties');

    let html = `
                <div class="mb-3">
                    <label class="form-label text-muted small fw-bold">Node ID: ${node.id}</label>
                </div>
            `;

    if (node.type === 'message') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Message Text</label>
                        <textarea class="form-control" id="prop-text" rows="4">${node.data.text || ''}</textarea>
                    </div>
                `;
    } else if (node.type === 'buttons') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Message Text</label>
                        <textarea class="form-control form-control-sm" id="prop-text" rows="2">${node.data.text || ''}</textarea>
                    </div>
                    <label class="form-label fw-semibold">Buttons</label>
                    <div id="prop-buttons-list">
                        ${(node.data.buttons || []).map((btn, i) => `
                            <div class="card mb-2 bg-body-tertiary">
                                <div class="card-body p-2">
                                    <div class="d-flex justify-content-between mb-2">
                                        <small class="fw-bold">Button ${i + 1}</small>
                                        <button class="btn btn-sm btn-outline-danger p-0 px-1" onclick="removeButton(${i})">&times;</button>
                                    </div>
                                    <input type="text" class="form-control form-control-sm mb-1" 
                                           id="btn-text-${i}" value="${btn.text}" 
                                           placeholder="Button Text (e.g., Where?)">
                                    <textarea class="form-control form-control-sm mb-1" 
                                              id="btn-reply-${i}" rows="2" 
                                              placeholder="Reply message when clicked">${btn.reply || btn.value || ''}</textarea>
                                    <select class="form-select form-select-sm" id="btn-type-${i}">
                                        <option value="reply" ${btn.type === 'reply' ? 'selected' : ''}>Quick Reply</option>
                                        <option value="url" ${btn.type === 'url' ? 'selected' : ''}>URL</option>
                                        <option value="call" ${btn.type === 'call' ? 'selected' : ''}>Call</option>
                                    </select>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn btn-sm btn-outline-primary w-100" onclick="addButtonToNode()">+ Add Button</button>
                 `;
    } else if (node.type === 'list') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Body Text</label>
                        <textarea class="form-control form-control-sm" id="prop-text" rows="2">${node.data.text || ''}</textarea>
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">List Title</label>
                         <input type="text" class="form-control form-control-sm" id="prop-title" value="${node.data.title || ''}" placeholder="Menu">
                    </div>
                    <label class="form-label fw-semibold">List Items</label>
                    <div id="prop-list-items">
                         ${(node.data.listItems || []).map((item, i) => `
                            <div class="card mb-2 bg-body-tertiary">
                                <div class="card-body p-2">
                                    <div class="d-flex justify-content-between mb-1">
                                         <small class="fw-bold">Item ${i + 1}</small>
                                         <button class="btn btn-sm btn-outline-danger p-0 px-1" onclick="removeListItem(${i})">&times;</button>
                                    </div>
                                    <input type="text" class="form-control form-control-sm mb-1" id="list-title-${i}" value="${item.title}" placeholder="Title">
                                    <input type="text" class="form-control form-control-sm" id="list-desc-${i}" value="${item.description || ''}" placeholder="Description">
                                </div>
                            </div>
                         `).join('')}
                    </div>
                    <button class="btn btn-sm btn-outline-primary w-100" onclick="addListItemToNode()">+ Add Item</button>
                 `;
    } else if (node.type === 'image' || node.type === 'video') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Media URL</label>
                        <input type="url" class="form-control form-control-sm" id="prop-mediaUrl" value="${node.data.mediaUrl || ''}" placeholder="https://...">
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Caption</label>
                        <textarea class="form-control form-control-sm" id="prop-caption" rows="3">${node.data.caption || ''}</textarea>
                    </div>
                 `;
    } else if (node.type === 'document') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Document URL</label>
                        <input type="url" class="form-control form-control-sm" id="prop-mediaUrl" value="${node.data.mediaUrl || ''}" placeholder="https://...">
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Filename</label>
                        <input type="text" class="form-control form-control-sm" id="prop-filename" value="${node.data.filename || ''}" placeholder="file.pdf">
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Caption</label>
                        <textarea class="form-control form-control-sm" id="prop-caption" rows="2">${node.data.caption || ''}</textarea>
                    </div>
                 `;
    } else if (node.type === 'delay') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Delay (Seconds)</label>
                        <input type="number" class="form-control" id="prop-delay" value="${node.data.delaySeconds || 2}" min="1">
                    </div>
                 `;
    } else if (node.type === 'condition') {
        html += `
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Variable</label>
                        <select class="form-select form-select-sm" id="prop-variable">
                            <option value="lastResponse">Last User Response</option>
                        </select>
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Condition</label>
                         <select class="form-select form-select-sm" id="prop-condition">
                            <option value="contains" ${node.data.condition === 'contains' ? 'selected' : ''}>Contains</option>
                            <option value="equals" ${node.data.condition === 'equals' ? 'selected' : ''}>Equals</option>
                            <option value="regex" ${node.data.condition === 'regex' ? 'selected' : ''}>Regex Pattern</option>
                        </select>
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Value</label>
                        <input type="text" class="form-control" id="prop-value" value="${node.data.value || ''}" placeholder="Value to match">
                    </div>
                 `;
    }

    if (node.type !== 'start') {
        html += `
                    <div class="mt-3 pt-2 border-top">
                        <button class="btn btn-primary btn-sm w-100" onclick="updateNodeProperty('${node.type}')">
                            <i class="bi bi-check-lg"></i> Update Node
                        </button>
                    </div>
                `;
    }

    panel.innerHTML = html;
}

function updateNodeProperty(type) {
    const node = currentFlowNodes.find(n => n.id === selectedNodeId);
    if (!node) return;

    if (type === 'message') {
        node.data.text = document.getElementById('prop-text').value;
    } else if (type === 'buttons') {
        node.data.text = document.getElementById('prop-text').value;
        const Buttons = [];
        const container = document.getElementById('prop-buttons-list');
        const btnCards = container.children;

        for (let i = 0; i < btnCards.length; i++) {
            Buttons.push({
                text: document.getElementById(`btn-text-${i}`).value,
                reply: document.getElementById(`btn-reply-${i}`).value,
                type: document.getElementById(`btn-type-${i}`).value
            });
        }
        node.data.buttons = Buttons;
    } else if (type === 'list') {
        node.data.text = document.getElementById('prop-text').value;
        node.data.title = document.getElementById('prop-title').value;
        const items = [];
        const container = document.getElementById('prop-list-items');
        const itemCards = container.children;
        for (let i = 0; i < itemCards.length; i++) {
            items.push({
                id: `item_${Date.now()}_${i}`,
                title: document.getElementById(`list-title-${i}`).value,
                description: document.getElementById(`list-desc-${i}`).value
            });
        }
        node.data.listItems = items;
    } else if (type === 'image' || type === 'video') {
        node.data.mediaUrl = document.getElementById('prop-mediaUrl').value;
        node.data.caption = document.getElementById('prop-caption').value;
    } else if (type === 'document') {
        node.data.mediaUrl = document.getElementById('prop-mediaUrl').value;
        node.data.caption = document.getElementById('prop-caption').value;
        node.data.filename = document.getElementById('prop-filename').value;
    } else if (type === 'delay') {
        node.data.delaySeconds = parseInt(document.getElementById('prop-delay').value);
    } else if (type === 'condition') {
        node.data.variable = document.getElementById('prop-variable').value;
        node.data.condition = document.getElementById('prop-condition').value;
        node.data.value = document.getElementById('prop-value').value;
    }

    // Refresh canvas and properties to show updated state
    renderCanvas();
    showNodeProperties(node); // Keep properties open

    // Highlight feedback
    const btn = document.querySelector('#node-properties button.btn-primary');
    if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check-all"></i> Saved';
        btn.classList.add('btn-success');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
        }, 1000);
    }
}

// Helper functions for array properties
function addButtonToNode() {
    const node = currentFlowNodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    if (!node.data.buttons) node.data.buttons = [];

    node.data.buttons.push({
        text: 'New Button',
        reply: 'You clicked this button!',
        type: 'reply'
    });
    showNodeProperties(node);
}

function removeButton(index) {
    const node = currentFlowNodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    node.data.buttons.splice(index, 1);
    showNodeProperties(node);
}

function addListItemToNode() {
    const node = currentFlowNodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    if (!node.data.listItems) node.data.listItems = [];
    node.data.listItems.push({ id: `item_${Date.now()}`, title: 'New Item', description: '' });
    showNodeProperties(node);
}

function removeListItem(index) {
    const node = currentFlowNodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    node.data.listItems.splice(index, 1);
    showNodeProperties(node);
}

// Toggle sidebar with persistence
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    }
}

// Initialize sidebar state
document.addEventListener('DOMContentLoaded', () => {
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const sidebar = document.getElementById('sidebar');
    if (sidebar && isCollapsed) {
        sidebar.classList.add('collapsed');
    }
});

// Load flows when tab is shown
const originalShowContentFB = showContent;
showContent = function (contentId) {
    originalShowContentFB(contentId);
    if (contentId === 'flow-builder') {
        loadAdvancedFlows();
    }
    if (contentId === 'bulk-messaging' && typeof allLeadsForBulk !== 'undefined' && allLeadsForBulk.length === 0) {
        // Check if loadBulkRecipients exists
        if (typeof loadBulkRecipients === 'function') loadBulkRecipients();
    }
    if (contentId === 'flows') {
        if (typeof fetchFlows === 'function') fetchFlows();
    }
};


// ========================================
// LIVE EFFECTS JAVASCRIPT UTILITIES
// ========================================

// 1. TOAST NOTIFICATION SYSTEM
function showToast(title, message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.error('Toast container not found!');
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-x-circle-fill',
        warning: 'bi-exclamation-triangle-fill',
        info: 'bi-info-circle-fill'
    };

    toast.innerHTML = `
                <div class="toast-icon">
                    <i class="bi ${icons[type]}"></i>
                </div>
                <div class="toast-content">
                    <div class="toast-title">${title}</div>
                    ${message ? `<div class="toast-message">${message}</div>` : ''}
                </div>
                <button class="toast-close" onclick="this.parentElement.remove()">
                    <i class="bi bi-x-lg"></i>
                </button>
                ${duration > 0 ? '<div class="toast-progress"></div>' : ''}
            `;

    // Add to container
    container.appendChild(toast);

    // Force reflow to ensure animation plays
    toast.offsetHeight;

    // Auto remove after duration
    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('removing');
                setTimeout(() => {
                    if (toast.parentElement) {
                        toast.remove();
                    }
                }, 300);
            }
        }, duration);
    }

    console.log(`✅ Toast created: ${type} - ${title}`);
    return toast;
}

// Convenience methods
window.toast = {
    success: (title, message, duration) => showToast(title, message, 'success', duration),
    error: (title, message, duration) => showToast(title, message, 'error', duration),
    warning: (title, message, duration) => showToast(title, message, 'warning', duration),
    info: (title, message, duration) => showToast(title, message, 'info', duration)
};


// 2. RIPPLE EFFECT
function createRipple(event, buttonElement) {
    const button = buttonElement || event.currentTarget;

    // Don't add ripple if button is disabled
    if (!button || button.disabled || button.classList.contains('btn-loading')) return;

    const ripple = document.createElement('span');
    ripple.classList.add('ripple');

    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    button.appendChild(ripple);

    setTimeout(() => ripple.remove(), 600);
}

// Add ripple to all buttons
function initRippleEffect() {
    document.addEventListener('click', (e) => {
        const button = e.target.closest('button, .btn, .nav-link');
        if (button && !button.classList.contains('no-ripple')) {
            createRipple(e, button);
        }
    });
}

// 3. NUMBER COUNTER ANIMATION
function animateNumber(element, start, end, duration = 1000) {
    if (!element) return;

    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    element.classList.add('counting');

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
            element.classList.remove('counting');
        }
        element.textContent = Math.floor(current);
    }, 16);
}

// Animate stats on page load
function animateStats() {
    const statElements = document.querySelectorAll('.stat-number, [id^="stat-"]');
    statElements.forEach(el => {
        const targetValue = parseInt(el.textContent) || 0;
        if (targetValue > 0) {
            el.textContent = '0';
            setTimeout(() => animateNumber(el, 0, targetValue, 1500), 300);
        }
    });
}

// 4. TYPING INDICATOR
function showTypingIndicator(container) {
    if (!container) return null;

    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = `
                <span>AI is typing</span>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            `;

    container.appendChild(indicator);
    return indicator;
}

function hideTypingIndicator(indicator) {
    if (indicator && indicator.parentElement) {
        indicator.remove();
    }
}

// 5. SKELETON LOADER
function createSkeletonCard() {
    return `
                <div class="skeleton-card">
                    <div class="skeleton-header">
                        <div class="skeleton skeleton-avatar"></div>
                        <div class="skeleton-text">
                            <div class="skeleton skeleton-line"></div>
                            <div class="skeleton skeleton-line short"></div>
                        </div>
                    </div>
                    <div class="skeleton skeleton-line medium"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line short"></div>
                    <div class="skeleton skeleton-button"></div>
                </div>
            `;
}

function showSkeletonLoaders(container, count = 3) {
    if (!container) return;

    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        container.innerHTML += createSkeletonCard();
    }
}

// BUTTON LOADING STATE HELPER
function setButtonLoading(button, loading = true) {
    if (!button) return;

    if (loading) {
        button.classList.add('btn-loading');
        button.disabled = true;
        // Wrap text in span if not already wrapped
        if (!button.querySelector('.btn-text')) {
            const text = button.innerHTML;
            button.innerHTML = `<span class="btn-text">${text}</span>`;
        }
    } else {
        button.classList.remove('btn-loading');
        button.disabled = false;
    }
}

// INITIALIZE ALL EFFECTS
function initLiveEffects() {
    // Initialize ripple effect
    initRippleEffect();

    // Animate stats on first load
    setTimeout(animateStats, 500);

    // Show welcome toast
    setTimeout(() => {
        toast.success('Welcome!', 'Dashboard loaded successfully', 3000);
    }, 1000);

    console.log('✨ Live effects initialized');
}

// Note: Initialization moved to end of script after all effects are defined


// ========================================
// ADVANCED EFFECTS JAVASCRIPT
// ========================================

// MORPHING ICON TOGGLE
function morphIcon(element) {
    if (!element) return;
    element.classList.toggle('morphed');
}

// Create morph icon programmatically
function createMorphIcon(iconFrom, iconTo, container) {
    const morphDiv = document.createElement('div');
    morphDiv.className = 'morph-icon';
    morphDiv.innerHTML = `
                <i class="bi ${iconFrom} icon-from"></i>
                <i class="bi ${iconTo} icon-to"></i>
            `;
    morphDiv.addEventListener('click', () => morphIcon(morphDiv));
    if (container) container.appendChild(morphDiv);
    return morphDiv;
}

// CONFETTI CELEBRATION
function triggerConfetti(duration = 3000) {
    const colors = ['#fbbf24', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444'];
    const confettiCount = 50;

    for (let i = 0; i < confettiCount; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.top = '-10px';
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = (Math.random() * 10 + 5) + 'px';
            confetti.style.height = (Math.random() * 10 + 5) + 'px';
            confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
            confetti.style.animationDelay = (Math.random() * 0.5) + 's';

            document.body.appendChild(confetti);

            setTimeout(() => confetti.remove(), duration);
        }, i * 30);
    }
}

// STARBURST EFFECT
function triggerStarburst(x, y) {
    const burst = document.createElement('div');
    burst.className = 'starburst';
    burst.style.left = x + 'px';
    burst.style.top = y + 'px';

    const particleCount = 12;
    const colors = ['#fbbf24', '#f59e0b', '#10b981', '#00d4aa'];

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'starburst-particle';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];

        const angle = (i / particleCount) * Math.PI * 2;
        const distance = 100 + Math.random() * 50;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;

        particle.style.setProperty('--tx', tx + 'px');
        particle.style.setProperty('--ty', ty + 'px');

        burst.appendChild(particle);
    }

    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 1000);
}

// Add pulse/glow to element
function addPulse(element, type = 'pulse') {
    if (!element) return;
    element.classList.add(type);
}

function removePulse(element, type = 'pulse') {
    if (!element) return;
    element.classList.remove(type);
}

// Add glow with specific color
function addGlow(element, color = '') {
    if (!element) return;
    const glowClass = color ? `glow-${color}` : 'glow';
    element.classList.add(glowClass);
}

function removeGlow(element) {
    if (!element) return;
    element.classList.remove('glow', 'glow-green', 'glow-blue', 'glow-red', 'glow-yellow');
}

// ENHANCED INITIALIZATION
const originalInitLiveEffects = initLiveEffects;
initLiveEffects = function () {
    // Call original init
    originalInitLiveEffects();

    // Add example pulse to unread badges (if any)
    setTimeout(() => {
        const badges = document.querySelectorAll('.badge.bg-danger, .badge.bg-success');
        badges.forEach(badge => {
            if (parseInt(badge.textContent) > 0) {
                addPulse(badge, 'pulse-fast');
            }
        });
    }, 2000);

    console.log('✨ Advanced effects initialized');
};

// Make functions globally available
window.morphIcon = morphIcon;
window.createMorphIcon = createMorphIcon;
window.triggerConfetti = triggerConfetti;
window.triggerStarburst = triggerStarburst;
window.addPulse = addPulse;
window.removePulse = removePulse;
window.addGlow = addGlow;
window.removeGlow = removeGlow;


// INITIALIZE ALL EFFECTS - Called after all functions are defined
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiveEffects);
} else {
    initLiveEffects();
}


// High-Intensity Background Particles
function initBgParticles() {
    const container = document.getElementById('bg-particle-container');
    if (!container) return;

    const particleCount = 20; // Reduced for performance optimization

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'bg-particle';

        // Random larger sizes for impact
        const size = Math.random() * 5 + 3;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;

        const moveX = (Math.random() - 0.5) * 300;
        const moveY = (Math.random() - 0.5) * 300;
        const duration = Math.random() * 15 + 10;
        const delay = Math.random() * -25;

        particle.style.setProperty('--move-x', `${moveX}px`);
        particle.style.setProperty('--move-y', `${moveY}px`);
        particle.style.setProperty('--duration', `${duration}s`);
        particle.style.setProperty('--delay', `${delay}s`);

        // Mix of Emerald Green and Electric Blue
        if (Math.random() > 0.5) {
            particle.style.background = 'rgba(0, 255, 128, 0.8)';
            particle.style.boxShadow = '0 0 15px rgba(0, 255, 128, 0.6)';
        } else {
            particle.style.background = 'rgba(0, 168, 255, 0.8)';
            particle.style.boxShadow = '0 0 15px rgba(0, 168, 255, 0.6)';
        }

        container.appendChild(particle);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initBgParticles();
    fetchFlows();
});
