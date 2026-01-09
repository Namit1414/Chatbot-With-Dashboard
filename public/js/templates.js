// ========================================
// TEMPLATES FUNCTIONALITY
// ========================================

let templateButtonCount = 0;

let currentTemplates = [];

// Load templates from Meta
async function loadTemplates() {
    try {
        const res = await fetch('/api/templates');
        const data = await res.json();
        currentTemplates = data.data || [];
        renderTemplatesList(currentTemplates);
    } catch (error) {
        console.error('Error loading templates:', error);
        document.getElementById('templates-list').innerHTML = `
            <tr><td colspan="6" class="text-center py-5 text-danger">Failed to load templates</td></tr>
        `;
    }
}

function renderTemplatesList(templates) {
    const list = document.getElementById('templates-list');
    if (!list) return;

    if (templates.length === 0) {
        list.innerHTML = `
            <tr><td colspan="6" class="text-center py-5 text-muted">
                <i class="bi bi-inbox" style="font-size: 3rem;"></i>
                <p class="mt-3">No templates found. Create your first template!</p>
            </td></tr>
        `;
        return;
    }

    list.innerHTML = templates.map(template => {
        const statusBadge = getTemplateStatusBadge(template.status);
        const date = new Date(template.created_time || Date.now()).toLocaleDateString();

        return `
            <tr>
                <td class="ps-4">
                    <div class="fw-bold">${template.name}</div>
                    <small class="text-muted">${template.id || 'N/A'}</small>
                </td>
                <td><span class="badge bg-secondary">${template.category || 'N/A'}</span></td>
                <td>${template.language || 'N/A'}</td>
                <td>${statusBadge}</td>
                <td><small>${date}</small></td>
                <td class="text-end pe-4">
                    <button class="btn btn-sm btn-outline-secondary" onclick="viewTemplateDetails('${template.id}')" title="View">
                        <i class="bi bi-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function getTemplateStatusBadge(status) {
    const statusMap = {
        'APPROVED': '<span class="badge bg-success">APPROVED</span>',
        'PENDING': '<span class="badge bg-warning text-dark">PENDING</span>',
        'IN_REVIEW': '<span class="badge bg-warning text-dark">IN REVIEW</span>',
        'REJECTED': '<span class="badge bg-danger">REJECTED</span>',
        'PAUSED': '<span class="badge bg-secondary">PAUSED</span>',
        'DISABLED': '<span class="badge bg-danger">DISABLED</span>'
    };
    return statusMap[status] || '<span class="badge bg-secondary">UNKNOWN</span>';
}

// Add button to template
function addTemplateButton() {
    templateButtonCount++;
    const container = document.getElementById('template-buttons-container');
    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'card bg-dark bg-opacity-50 border-light border-opacity-10 mb-3 p-3';
    buttonDiv.id = `template-button-${templateButtonCount}`;

    buttonDiv.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="mb-0 small fw-bold text-secondary">Button #${templateButtonCount}</h6>
            <button type="button" class="btn btn-link text-danger p-0" onclick="removeTemplateButton(${templateButtonCount})">
                <i class="bi bi-trash"></i> Remove
            </button>
        </div>
        <div class="row g-3">
            <div class="col-md-4">
                <label class="form-label x-small text-muted">Type</label>
                <select class="form-select form-select-sm bg-black border-0 text-white template-button-type" 
                    onchange="toggleButtonInputs(${templateButtonCount}, this.value)">
                    <option value="QUICK_REPLY">Quick Reply</option>
                    <option value="PHONE_NUMBER">Call Number</option>
                    <option value="URL">Visit Website</option>
                </select>
            </div>
            <div class="col-md-4">
                <label class="form-label x-small text-muted">Label</label>
                <input type="text" class="form-control form-control-sm bg-black border-0 text-white template-button-text" 
                    placeholder="Button text" maxlength="20">
            </div>
            <div class="col-md-4 extra-input-col" style="display: none;">
                <label class="form-label x-small text-muted extra-label">Value</label>
                <input type="text" class="form-control form-control-sm bg-black border-0 text-white template-button-value" 
                    placeholder="Enter value">
            </div>
        </div>
    `;
    container.appendChild(buttonDiv);
}

function toggleButtonInputs(id, type) {
    const parent = document.getElementById(`template-button-${id}`);
    const extraCol = parent.querySelector('.extra-input-col');
    const extraLabel = parent.querySelector('.extra-label');
    const extraInput = parent.querySelector('.template-button-value');

    if (type === 'QUICK_REPLY') {
        extraCol.style.display = 'none';
    } else {
        extraCol.style.display = 'block';
        if (type === 'PHONE_NUMBER') {
            extraLabel.innerText = 'Phone (with country code)';
            extraInput.placeholder = 'e.g., 911234567890';
        } else {
            extraLabel.innerText = 'Website URL';
            extraInput.placeholder = 'e.g., https://example.com';
        }
    }
}

function removeTemplateButton(id) {
    document.getElementById(`template-button-${id}`)?.remove();
}

// Toggle header text input
document.addEventListener('DOMContentLoaded', () => {
    const headerTypeSelect = document.getElementById('template-header-type');
    const headerTextInput = document.getElementById('template-header-text');

    if (headerTypeSelect && headerTextInput) {
        headerTypeSelect.addEventListener('change', (e) => {
            headerTextInput.style.display = e.target.value === 'TEXT' ? 'block' : 'none';
        });
    }
});

// Submit template form
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('create-template-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('template-name').value.trim();
            const category = document.getElementById('template-category').value;
            const language = document.getElementById('template-language').value;
            const headerType = document.getElementById('template-header-type').value;
            const headerText = document.getElementById('template-header-text').value.trim();
            const body = document.getElementById('template-body').value.trim();
            const footer = document.getElementById('template-footer').value.trim();

            // Collect buttons
            const buttons = [];
            const buttonGroups = document.querySelectorAll('[id^="template-button-"]');
            buttonGroups.forEach(group => {
                const type = group.querySelector('.template-button-type').value;
                const text = group.querySelector('.template-button-text').value.trim();
                const value = group.querySelector('.template-button-value').value.trim();

                if (text) {
                    const btn = { type, text };
                    if (type === 'PHONE_NUMBER') btn.phone_number = value;
                    if (type === 'URL') btn.url = value;
                    buttons.push(btn);
                }
            });

            const templateData = {
                name,
                category,
                language,
                body,
                header: headerType === 'TEXT' && headerText ? { type: 'TEXT', text: headerText } : null,
                footer: footer || null,
                buttons: buttons.length > 0 ? buttons : null
            };

            try {
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

                const res = await fetch('/api/templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(templateData)
                });

                const data = await res.json();

                if (res.ok) {
                    if (typeof toast !== 'undefined') {
                        toast.success('Success', 'Template submitted to Meta for review!');
                    } else {
                        alert('Template submitted successfully!');
                    }
                    bootstrap.Modal.getInstance(document.getElementById('createTemplateModal')).hide();
                    form.reset();
                    templateButtonCount = 0;
                    document.getElementById('template-buttons-container').innerHTML = '';
                    loadTemplates();
                } else {
                    throw new Error(data.details || data.error || 'Failed to create template');
                }
            } catch (error) {
                console.error('Error creating template:', error);
                if (typeof toast !== 'undefined') {
                    toast.error('Error', error.message);
                } else {
                    alert('Error: ' + error.message);
                }
            } finally {
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="bi bi-send-fill me-2"></i> Submit to Meta for Review';
            }
        });
    }
});

function viewTemplateDetails(templateId) {
    const template = currentTemplates.find(t => t.id === templateId);
    if (!template) {
        if (typeof toast !== 'undefined') toast.error('Error', 'Template details not found');
        return;
    }

    document.getElementById('view-template-name').innerText = template.name;
    document.getElementById('view-template-status').innerText = template.status;
    document.getElementById('view-template-lang').innerText = template.language;
    document.getElementById('view-template-cat').innerText = template.category;

    // Change status badge color
    const statusBadge = document.getElementById('view-template-status');
    statusBadge.className = 'badge mt-1 ';
    if (template.status === 'APPROVED') {
        statusBadge.classList.add('bg-success-subtle', 'text-success', 'border', 'border-success-subtle');
    } else if (['PENDING', 'IN_REVIEW', 'PENDING_APPROVAL'].includes(template.status)) {
        statusBadge.classList.add('bg-warning-subtle', 'text-warning', 'border', 'border-warning-subtle');
    } else {
        statusBadge.classList.add('bg-danger-subtle', 'text-danger', 'border', 'border-danger-subtle');
    }

    // Body content
    const bodyComp = template.components.find(c => c.type === 'BODY') || {};
    document.getElementById('view-template-body').innerText = bodyComp.text || 'No content';

    // Footer
    const footerComp = template.components.find(c => c.type === 'FOOTER');
    const footerContainer = document.getElementById('view-template-footer-container');
    if (footerComp) {
        footerContainer.style.display = 'block';
        document.getElementById('view-template-footer').innerText = footerComp.text;
    } else {
        footerContainer.style.display = 'none';
    }

    // Buttons
    const buttonsComp = template.components.find(c => c.type === 'BUTTONS');
    const buttonsContainer = document.getElementById('view-template-buttons-container');
    const buttonsList = document.getElementById('view-template-buttons-list');
    buttonsList.innerHTML = '';

    if (buttonsComp && buttonsComp.buttons && buttonsComp.buttons.length > 0) {
        buttonsContainer.style.display = 'block';
        buttonsComp.buttons.forEach(btn => {
            const span = document.createElement('span');
            span.className = 'badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-20 px-3 py-2';
            span.innerHTML = `<i class="bi bi-hand-index-thumb me-2"></i> ${btn.text}`;
            buttonsList.appendChild(span);
        });
    } else {
        buttonsContainer.style.display = 'none';
    }

    const modal = new bootstrap.Modal(document.getElementById('viewTemplateModal'));
    modal.show();
}


// Make functions globally accessible
window.addTemplateButton = addTemplateButton;
window.removeTemplateButton = removeTemplateButton;
window.toggleButtonInputs = toggleButtonInputs;
window.viewTemplateDetails = viewTemplateDetails;
window.loadTemplates = loadTemplates;
