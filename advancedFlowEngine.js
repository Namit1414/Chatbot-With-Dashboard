import AdvancedFlow from "./models/AdvancedFlow.js";
import ScheduledBulkMessage from "./models/ScheduledBulkMessage.js";

import Lead from "./models/Lead.js";
import { sendWhatsAppBusinessMessage } from "./whatsappBusinessAPI.js";
import { logToFile } from "./debugLogger.js";

// Session management for multi-step flows
// Session management for multi-step flows
const flowSessions = new Map(); // phoneNumber -> { flowId, currentNodeId, variables }
const tempFlows = new Map(); // flowId -> flowObject (for testing unsaved flows)

/**
 * Helper to find session with fuzzy matching
 * Handles cases where user enters local format (890...) but WhatsApp sends intl (91890...)
 */
export function findSession(phone) {
    if (flowSessions.has(phone)) return { phone, session: flowSessions.get(phone) };

    const phoneStr = String(phone);
    // Scan all sessions for partial match
    for (const [key, session] of flowSessions.entries()) {
        const keyStr = String(key);
        // Check if one ends with the other (suffix match for phone numbers)
        if (keyStr.endsWith(phoneStr) || phoneStr.endsWith(keyStr)) {
            console.log(`[FlowEngine] Fuzzy match found: '${phone}' matched session '${key}'`);
            logToFile(`[FuzzyMatch] Input: ${phone} matched SessionKey: ${key}`);
            return { phone: key, session };
        }
    }
    return null;
}

export function registerTempFlow(flow) {
    tempFlows.set(flow._id, flow);
    // Auto-expire temp flows after 1 hour to prevent memory leaks
    setTimeout(() => tempFlows.delete(flow._id), 3600000);
}

/**
 * Execute advanced flow when triggered
 */
export async function executeAdvancedFlow(phone, message) {
    try {
        console.log(`[FlowEngine] executeAdvancedFlow called for: ${phone} (Message: "${message}")`);
        console.log(`[FlowEngine] Active Sessions: ${flowSessions.size}. Has session? ${flowSessions.has(phone)}`);

        // Check if user has an active flow session
        const activeSessionObj = findSession(phone);

        if (activeSessionObj) {
            console.log(`[FlowEngine] Resuming session for ${phone} (Session Key: ${activeSessionObj.phone})`);
            logToFile(`[Resume] Found session for ${activeSessionObj.phone} (Input: ${phone})`);
            // Pass the original session key to ensure consistency
            return await continueFlow(activeSessionObj.phone, message);
        }

        // Find matching flow by trigger
        const flows = await AdvancedFlow.find({ active: true });
        const matchedFlow = findMatchingFlow(flows, message);

        if (!matchedFlow) {
            console.log(`[FlowEngine] No matching new flow for message: "${message}"`);
            return null; // No flow matched
        }

        console.log(`[FlowEngine] Found matching new flow: ${matchedFlow.name}`);
        // Start new flow session
        return await startFlow(phone, matchedFlow);
    } catch (error) {
        console.error('Error executing advanced flow:', error);
        return null;
    }
}

/**
 * Find flow that matches the message
 */
function findMatchingFlow(flows, message) {
    const msgLower = message.toLowerCase().trim();

    for (const flow of flows) {
        const trigger = flow.trigger.toLowerCase();

        switch (flow.triggerType) {
            case 'exact':
                if (msgLower === trigger) return flow;
                break;
            case 'contains':
            case 'keyword':
                if (msgLower.includes(trigger)) return flow;
                break;
            case 'regex':
                try {
                    const regex = new RegExp(trigger, 'i');
                    if (regex.test(message)) return flow;
                } catch (e) {
                    console.error('Invalid regex in flow:', flow._id);
                }
                break;
        }
    }

    return null;
}

/**
 * Start a new flow session
 */
export async function startFlow(phone, flow) {
    console.log(`[FlowEngine] Starting flow "${flow.name}" (${flow._id}) for ${phone}`);

    // Find start node
    const startNode = flow.nodes.find(n => n.type === 'start');

    if (!startNode) {
        console.error('Flow has no start node:', flow._id);
        return 'Flow configuration error.';
    }

    // Create session
    flowSessions.set(phone, {
        flowId: flow._id,
        currentNodeId: startNode.id,
        variables: {},
        nodeHistory: [startNode.id]
    });
    console.log(`[FlowEngine] Session created for ${phone}. Total sessions: ${flowSessions.size}`);

    // Update stats
    await updateFlowStats(flow._id, 'sent');

    // Find next node after start
    const nextNode = findNextNode(flow, startNode.id);

    if (!nextNode) {
        console.log('[FlowEngine] Flow started but no next node after start.');
        endFlowSession(phone);
        return null; // Or { type: 'no_reply' }? If it starts and ends immediately, maybe null is fine or we want to prevent AI.
        // If we return null, AI picks up. If we want silence, use no_reply.
        // Let's assume if it starts and halts, it's a dead flow.
    }

    // Execute next node with burst support
    return await executeNodeWithBurst(phone, flow, nextNode);
}

/**
 * Executes a node and automatically advances through any subsequent 
 * non-interactive nodes (message, image, video, document, delay)
 * in a single execution cycle (burst).
 */
async function executeNodeWithBurst(phone, flow, firstNode) {
    const session = flowSessions.get(phone);
    if (!session) return null;

    // 1. Execute the first node
    session.currentNodeId = firstNode.id;
    if (!session.nodeHistory.includes(firstNode.id)) {
        session.nodeHistory.push(firstNode.id);
    }

    let currentResult = await executeNode(phone, flow, firstNode);
    let lastNode = firstNode;

    // 2. Sequential Burst handling
    // Advance as long as we have simple content nodes
    while (currentResult && ['message', 'image', 'video', 'document', 'delay'].includes(lastNode.type)) {
        const nextAfter = findNextNode(flow, lastNode.id, null, session);

        if (nextAfter && ['message', 'image', 'video', 'document', 'delay'].includes(nextAfter.type)) {
            // Send current node content immediately using the direct API helper
            console.log(`[Burst] Sending intermediate ${lastNode.type}...`);
            await sendWhatsAppBusinessMessage(
                phone,
                { ...currentResult, messageType: currentResult.type || currentResult.messageType },
                process.env.WHATSAPP_TOKEN,
                process.env.PHONE_NUMBER_ID
            );

            // Small delay for delivery stability
            await new Promise(r => setTimeout(r, 400));

            // Advance session and execute next
            console.log(`[Burst] Advancing to: ${nextAfter.id} (${nextAfter.type})`);
            session.currentNodeId = nextAfter.id;
            session.nodeHistory.push(nextAfter.id);
            currentResult = await executeNode(phone, flow, nextAfter);
            lastNode = nextAfter;
        } else {
            break;
        }
    }

    return currentResult;
}

/**
 * Continue existing flow session
 */
async function continueFlow(phone, message) {
    console.log(`\n========== CONTINUE FLOW ==========`);
    console.log(`Phone: ${phone}`);
    console.log(`Message: "${message}"`);
    console.log(`===================================\n`);

    logToFile(`[Continue] Phone: ${phone}, Msg: ${message}`);
    const session = flowSessions.get(phone);

    if (!session) return null;

    // Load flow
    let flow;
    if (session.flowId.toString().startsWith('temp')) {
        flow = tempFlows.get(session.flowId);
    } else {
        flow = await AdvancedFlow.findById(session.flowId);
    }

    if (!flow) {
        console.warn('Flow definition not found (expired temp flow or deleted DB flow). Ending session.');
        endFlowSession(phone);
        return null;
    }

    // Get current node
    const currentNode = flow.nodes.find(n => n.id === session.currentNodeId);
    console.log(`Current Node: ${session.currentNodeId} (${currentNode?.type})`);

    if (!currentNode) {
        endFlowSession(phone);
        return null;
    }

    // ✅ ROBUST INTERACTIVE HANDLING (Buttons & Lists)
    if (currentNode.type === 'buttons' || currentNode.type === 'cta' || currentNode.type === 'list') {
        console.log(`[Interactive] Current node is ${currentNode.type}. Searching for match...`);

        let matchedBranch = null;
        let responseValue = message; // Default to the incoming message/ID

        if (currentNode.type === 'buttons' || currentNode.type === 'cta') {
            const buttons = currentNode.data.buttons || [];
            // Match by ID first (WhatsApp button_reply.id), then by text
            const btn = buttons.find(b =>
                message === b.id ||
                message.toLowerCase().trim() === b.text.toLowerCase().trim() ||
                (b.text.length > 20 && message === b.text.substring(0, 20)) // Handle truncation
            );

            if (btn) {
                console.log(`✓ Button matched: "${btn.text}"`);
                matchedBranch = btn;
                responseValue = btn.text;
                session.variables.lastButtonClicked = btn.text;
            }
        } else if (currentNode.type === 'list') {
            // Find matched row in sections
            let allRows = [];
            (currentNode.data.sections || []).forEach(s => {
                (s.rows || []).forEach(r => allRows.push(r));
            });
            // Also check listItems for backward compatibility
            (currentNode.data.listItems || []).forEach(r => allRows.push(r));

            const row = allRows.find(r =>
                message === r.id ||
                message.toLowerCase().trim() === r.title.toLowerCase().trim()
            );

            if (row) {
                console.log(`✓ List row matched: "${row.title}"`);
                matchedBranch = row;
                responseValue = row.title;
                session.variables.lastListItemSelected = row.title;
            }
        }

        if (matchedBranch) {
            // Store in session
            session.variables.lastResponse = responseValue;
            await updateFlowStats(flow._id, 'clicked');

            // Find next node based on connection label (Text/Title) or handle ID
            let nextNode = null;
            const branchText = (matchedBranch.text || matchedBranch.title || '').toLowerCase().trim();
            const branchId = matchedBranch.id;

            console.log(`[Interactive] Seeking connection for branch: "${branchText}" (ID: ${branchId})`);

            // 1. Try matching by sourceHandle (Most reliable for specific branches)
            let connection = flow.connections?.find(c =>
                c.source === currentNode.id && c.sourceHandle === branchId
            );

            // 2. Fallback to matching by label (backward compatibility or manual labels)
            if (!connection) {
                connection = flow.connections?.find(c =>
                    c.source === currentNode.id &&
                    c.label?.toLowerCase().trim() === branchText
                );
            }

            if (connection) {
                nextNode = flow.nodes.find(n => n.id === connection.target);
            }

            // Fallback to finding by raw message if connection didn't match ID/Text
            if (!nextNode) {
                nextNode = findNextNode(flow, currentNode.id, responseValue, session);
            }

            if (nextNode) {
                return await executeNodeWithBurst(phone, flow, nextNode);
            } else {
                // No next connection, but we matched a button. Return feedback/reply.
                const feedbackText = matchedBranch.reply || matchedBranch.value || responseValue;
                endFlowSession(phone);
                return {
                    type: 'text',
                    content: personalizeMessage(feedbackText, phone, session)
                };
            }
        } else {
            console.log('⚠️ No interactive match found. Fallthrough to search.');
        }
    }

    // Store user response
    session.variables.lastResponse = message;

    // Find next node
    const nextNode = findNextNode(flow, currentNode.id, message, session);

    if (!nextNode) {
        console.log('Flow ended (no next node).');
        logToFile(`[FlowEnd] No next node after ${currentNode.id}`);
        endFlowSession(phone);
        // Return null to allow fallback to AI if no more nodes in flow
        return null;
    }

    // Execute next node
    return await executeNode(phone, flow, nextNode);
}

/**
 * Find the next node in the flow
 */


/**
 * Evaluate conditional logic
 */
function evaluateCondition(condition, userMessage, session) {
    if (!condition || !userMessage) return false;

    const msgLower = userMessage.toLowerCase().trim();
    const condLower = condition.toLowerCase().trim();

    // Simple condition matching
    if (condLower.startsWith('contains:')) {
        const checkValue = condLower.replace('contains:', '').trim();
        return msgLower.includes(checkValue);
    }

    if (condLower.startsWith('equals:')) {
        const checkValue = condLower.replace('equals:', '').trim();
        return msgLower === checkValue;
    }

    // Default: exact match
    return msgLower === condLower;
}

/**
 * Execute a specific node
 */
async function executeNode(phone, flow, node, depth = 0) {
    // Loop Protection
    if (depth > 20) {
        console.error(`[FlowEngine] Infinite loop detected for ${phone}. Stops at node ${node.id}`);
        logToFile(`[LoopDetect] Depth ${depth} reached. Stopping.`);
        return { type: 'text', content: 'Use the force, Luke... but not in a loop. (System Loop Detected)' };
    }

    // Use exact match here as we should have resolved the correct phone key by now
    // But for safety in other calls, we can use findSession if needed. 
    // However, executeNode is internal and usually passed the correct phone key.
    // Let's stick to get() but logging if missing.
    const session = flowSessions.get(phone);

    if (!session) {
        console.error(`[FlowEngine] Critical: Session missing in executeNode for ${phone}`);
        logToFile(`[Critical] Session missing in executeNode for ${phone}`);
        return null;
    }

    // Update session current node
    session.currentNodeId = node.id;
    session.nodeHistory.push(node.id);

    // Execute based on node type
    switch (node.type) {
        case 'message':
            return await executeMessageNode(phone, flow, node); // Messages don't recurse synchronously usually

        case 'buttons':
            return await executeButtonsNode(phone, flow, node);

        case 'list':
            return await executeListNode(phone, flow, node);

        case 'cta':
            return await executeCtaNode(phone, flow, node);

        case 'image':
            return await executeImageNode(phone, flow, node);

        case 'video':
            return await executeVideoNode(phone, flow, node);

        case 'document':
            return await executeDocumentNode(phone, flow, node);

        case 'delay':
            return await executeDelayNode(phone, flow, node);

        case 'condition':
            // Pass depth + 1
            return await executeConditionNode(phone, flow, node, depth + 1);

        default:
            console.warn('Unknown node type:', node.type);
            return null;
    }
}

/**
 * Execute message node
 */
async function executeMessageNode(phone, flow, node) {
    const message = personalizeMessage(node.data.text || '', phone, flowSessions.get(phone));

    // Check if there's a next node immediately
    const nextNode = findNextNode(flow, node.id);

    if (nextNode && nextNode.type === 'delay') {
        // If next is delay, execute it and return the message
        await executeDelayNode(phone, flow, nextNode);
    }

    await updateFlowStats(flow._id, 'delivered');

    return { type: 'text', content: message };
}

/**
 * Execute buttons node (CTA buttons)
 */
async function executeButtonsNode(phone, flow, node) {
    const message = personalizeMessage(node.data.text || '', phone, flowSessions.get(phone));
    const buttons = node.data.buttons || [];

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'buttons',
        content: message,
        buttons: buttons.map(btn => ({
            id: btn.id,
            text: btn.text,
            type: btn.type, // 'reply', 'url', 'call'
            value: btn.value
        }))
    };
}

/**
 * Execute CTA node
 */
async function executeCtaNode(phone, flow, node) {
    const message = personalizeMessage(node.data.text || '', phone, flowSessions.get(phone));

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'buttons',
        content: message,
        buttons: [{
            type: node.data.ctaType === 'phone' ? 'call' : 'url',
            text: node.data.buttonText || 'Click Here',
            value: node.data.ctaType === 'phone' ? node.data.phoneNumber : node.data.url
        }]
    };
}

/**
 * Execute list node
 */
async function executeListNode(phone, flow, node) {
    const message = personalizeMessage(node.data.text || '', phone, flowSessions.get(phone));

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'list',
        content: message,
        buttonText: node.data.buttonText,
        sections: node.data.sections,
        items: node.data.listItems || []
    };
}

/**
 * Execute image node
 */
async function executeImageNode(phone, flow, node) {
    const caption = personalizeMessage(node.data.caption || '', phone, flowSessions.get(phone));

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'image',
        url: node.data.url || node.data.mediaUrl, // Support both names
        caption: caption
    };
}

/**
 * Execute video node
 */
async function executeVideoNode(phone, flow, node) {
    const caption = personalizeMessage(node.data.caption || '', phone, flowSessions.get(phone));

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'video',
        url: node.data.url || node.data.mediaUrl, // Support both names
        caption: caption
    };
}

/**
 * Execute document node
 */
async function executeDocumentNode(phone, flow, node) {
    const caption = personalizeMessage(node.data.caption || '', phone, flowSessions.get(phone));

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'document',
        url: node.data.url || node.data.mediaUrl, // Support both names
        filename: node.data.filename || 'document.pdf',
        caption: caption
    };
}

/**
 * Execute delay node
 */
async function executeDelayNode(phone, flow, node) {
    const delayMs = (node.data.delay || node.data.delaySeconds || 2) * 1000; // Support both names

    // Schedule next node execution
    setTimeout(async () => {
        const nextNode = findNextNode(flow, node.id);
        if (nextNode) {
            const result = await executeNode(phone, flow, nextNode);
            if (result) {
                // Send the delayed message (this would need to be handled by the webhook)
                // Note: For a real app, we need a way to send async messages back to the user
                // potentially via a callback or event emitter.
                console.log('Delayed message generated:', result);
                // For now, we can only log it because the HTTP response is already sent.
                // To fix this properly, we'd need to call sendWhatsAppMessage here directly.
                const { sendWhatsAppBusinessMessage } = await import('./whatsappBusinessAPI.js');

                // Map 'type' to 'messageType' if needed
                let msgToSend = result;
                if (result.type && !result.messageType) {
                    msgToSend = { ...result, messageType: result.type };
                }

                // Helper to send async
                // We need token and phoneID. Assuming they are in process.env
                if (process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID) {
                    await sendWhatsAppBusinessMessage(
                        phone,
                        msgToSend,
                        process.env.WHATSAPP_TOKEN,
                        process.env.PHONE_NUMBER_ID
                    );
                }
            }
        }
    }, delayMs);

    return { type: 'no_reply' }; // Handled, but no immediate response
}


/**
 * Helper to check if a condition node evaluates to true
 */
function isConditionMet(node, session) {
    if (!node || node.type !== 'condition') return false;

    const variable = node.data.variable || 'lastResponse';
    const conditionType = node.data.condition || 'equals';
    const targetValue = (node.data.value || '').toLowerCase().trim();

    // Get actual value from session variables
    const actualValue = (session?.variables[variable] || '').toLowerCase().trim();

    console.log(`[ConditionCheck] ${variable} ("${actualValue}") ${conditionType} "${targetValue}"`);

    switch (conditionType) {
        case 'equals':
            return actualValue === targetValue;
        case 'contains':
            return actualValue.includes(targetValue);
        case 'regex':
            try {
                const regex = new RegExp(targetValue, 'i');
                return regex.test(actualValue);
            } catch (e) {
                console.error('Invalid Regex:', e);
                return false;
            }
        default:
            return actualValue === targetValue;
    }
}

/**
 * Execute condition node
 */
async function executeConditionNode(phone, flow, node, depth = 0) {
    console.log(`Executing Condition Node ${node.id} (Depth: ${depth})`);

    // Check condition
    const session = flowSessions.get(phone);
    const passed = isConditionMet(node, session);

    if (!passed) {
        console.log('Condition Failed. Stopping flow path.');
        return { type: 'no_reply' };
    }

    console.log('Condition Passed. Proceeding.');

    // Find next node (pass null/empty session to avoid recursive condition check if not needed, 
    // but here we just want the linear next node after the condition)
    const nextNode = findNextNode(flow, node.id, null, session);

    if (nextNode) {
        return await executeNode(phone, flow, nextNode, depth + 1);
    }

    return { type: 'no_reply' };
}

/**
 * Find the next node in the flow
 */
function findNextNode(flow, currentNodeId, userMessage = null, session = null) {
    // Find connections from current node
    const connections = flow.connections?.filter(c => c.source === currentNodeId) || [];

    if (connections.length === 0) {
        // No connections, check for sequential next node
        const currentIndex = flow.nodes.findIndex(n => n.id === currentNodeId);
        if (currentIndex >= 0 && currentIndex < flow.nodes.length - 1) {
            return flow.nodes[currentIndex + 1];
        }
        return null;
    }

    // 1. Check for labeled connections (Explicit branching)
    for (const connection of connections) {
        if (connection.label && userMessage) {
            // Check if label matches message
            // Evaluate condition connection.label vs userMessage if needed
            // Reuse evaluateCondition helper for connection labels
            if (evaluateCondition(connection.label, userMessage, session)) {
                return flow.nodes.find(n => n.id === connection.target);
            }
        }
    }

    // 2. Check for connections to Condition Nodes (Implicit branching by Condition)
    // AND detection of condition mode to prevent fallback
    let hasConditionConnections = false;

    for (const connection of connections) {
        const targetNode = flow.nodes.find(n => n.id === connection.target);
        if (targetNode && targetNode.type === 'condition') {
            hasConditionConnections = true;
            // We need the session to evaluate
            if (session && isConditionMet(targetNode, session)) {
                console.log(`[SmartRoute] Route found via Condition Node: ${targetNode.id}`);
                return targetNode;
            }
        }
    }

    // If we checked condition nodes and none matched, we should STOP here.
    // Do NOT fallback to the first connection, as that would execute the wrong branch.
    if (hasConditionConnections) {
        console.log('[SmartRoute] Condition nodes present but none matched. Stopping.');
        return null;
    }

    // 3. Fallback: Take first connection (default path, e.g. "always continue")
    // Use this only if no specific condition check was involved (e.g. linear flow)
    const firstConnection = connections[0];
    return flow.nodes.find(n => n.id === firstConnection.target);
}

/**
 * Personalize message with variables
 */
function personalizeMessage(text, phone, session) {
    let result = text;

    // Replace {phone}
    result = result.replace(/{phone}/g, phone);

    // Replace session variables
    // Resolve session if not passed or ensure we have it
    const activeSession = session || flowSessions.get(phone);

    if (activeSession?.variables) {
        Object.keys(activeSession.variables).forEach(key => {
            const regex = new RegExp(`{${key}}`, 'g');
            result = result.replace(regex, activeSession.variables[key] || '');
        });
    }

    return result;
}

/**
 * Update flow statistics
 */
async function updateFlowStats(flowId, metric) {
    // Skip stats for temporary test flows
    if (typeof flowId === 'string' && flowId.startsWith('temp')) {
        return;
    }

    try {
        const flow = await AdvancedFlow.findById(flowId);
        if (flow && flow.stats[metric] !== undefined) {
            flow.stats[metric]++;
            await flow.save();
        }
    } catch (error) {
        console.error('Error updating flow stats:', error);
    }
}

/**
 * End flow session
 */
function endFlowSession(phone) {
    flowSessions.delete(phone);
}

/**
 * Clear session for a phone number (exposed for external use)
 */
export function clearFlowSession(phone) {
    const s = findSession(phone);
    if (s) {
        endFlowSession(s.phone);
    }
}

/**
 * Get active session info
 */
export function getFlowSession(phone) {
    const s = findSession(phone);
    return s ? s.session : null;
}

/**
 * Initialize Scheduler for Scheduled Flows
 */
export function initScheduler() {
    console.log('Advanced Flow Scheduler initialized...');

    // Check every minute
    setInterval(async () => {
        try {
            const now = new Date();
            const leadCount = await Lead.countDocuments({});

            // DIAGNOSTIC LOG: List ALL scheduled flows regardless of active status
            const allScheduled = await AdvancedFlow.find({ triggerType: 'scheduled' });

            console.log(`[Scheduler Diagnostic] ${now.toISOString()} | Scheduled Flows Total: ${allScheduled.length} | Total Leads: ${leadCount}`);

            if (allScheduled.length > 0) {
                allScheduled.forEach(f => {
                    const nextRun = f.schedule?.nextRun;
                    const due = nextRun && nextRun <= now;
                    console.log(`[Scheduler Diagnostic] - Flow: "${f.name}" (${f._id}) | Active: ${f.active !== false} | nextRun: ${nextRun ? nextRun.toISOString() : 'NULL'} | Due: ${due}`);
                });
            }

            // Find flows that are due. Use $ne: false to include ones where 'active' is undefined
            const flows = await AdvancedFlow.find({
                active: { $ne: false },
                triggerType: 'scheduled',
                'schedule.nextRun': { $lte: now }
            });

            if (flows.length > 0) {
                console.log(`[Scheduler] ${now.toISOString()}: Found ${flows.length} flows due for execution.`);
                for (const flow of flows) {
                    console.log(`[Scheduler] Triggering flow: "${flow.name}" (${flow._id})`);
                    await executeScheduledFlow(flow);
                }
            }

            // Check for scheduled bulk messages
            const scheduledMessages = await ScheduledBulkMessage.find({
                status: 'pending',
                scheduledTime: { $lte: now }
            });

            if (scheduledMessages.length > 0) {
                console.log(`Scheduler: Found ${scheduledMessages.length} bulk messages due for execution at ${now.toISOString()}`);
                for (const msg of scheduledMessages) {
                    await executeScheduledBulkMessage(msg);
                }
            }
        } catch (error) {
            console.error('Scheduler error:', error);
        }
    }, 5000); // Check every 5 seconds
}

/**
 * Execute a single scheduled flow
 */
async function executeScheduledFlow(flow) {
    console.log(`Executing scheduled flow: "${flow.name}"`);

    // 1. Identify Recipients
    let recipients = [];
    try {
        const config = flow.recipientConfig || { audienceType: 'all' };
        console.log(`[Scheduler] Audience config for "${flow.name}":`, JSON.stringify(config));

        if (config.audienceType === 'tags') {
            const tags = config.tags || [];
            if (tags.length > 0) {
                recipients = await Lead.find({ tags: { $in: tags } });
            }
        } else if (config.audienceType === 'specific' || config.audienceType === 'individual' || config.audienceType === 'manual') {
            const phones = config.phones || [];
            recipients = phones.map(p => ({
                phone: p.replace(/\D/g, ''), // clean number
                name: 'User'
            })).filter(r => r.phone.length > 0);
        } else {
            // Default to 'all'
            console.log(`[Scheduler] Fetching all leads for flow "${flow.name}"`);
            recipients = await Lead.find({});
        }
    } catch (e) {
        console.error(`[Scheduler] Error fetching recipients for flow "${flow.name}":`, e);
        recipients = [];
    }

    if (recipients.length === 0) {
        console.warn(`[Scheduler] No recipients found for flow "${flow.name}". Stopping.`);
        flow.schedule.lastRun = new Date();
        flow.active = false;
        await flow.save();
        return;
    }

    console.log(`[Scheduler] Targeting ${recipients.length} recipients for flow "${flow.name}"`);

    // 2. Execute Flow for each recipient
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneId) {
        console.error('[Scheduler] WhatsApp environment variables missing! Cannot send.');
        return;
    }

    for (const recipient of recipients) {
        try {
            console.log(`[Scheduler] Starting flow for recipient: ${recipient.phone}`);
            // Initiate flow
            const result = await startFlow(recipient.phone, flow);

            if (result) {
                // Determine message format
                let msgToSend = result;
                if (result.type && !result.messageType) {
                    msgToSend = { ...result, messageType: result.type };
                }

                console.log(`[Scheduler] Sending initial message to ${recipient.phone}...`);
                await sendWhatsAppBusinessMessage(recipient.phone, msgToSend, token, phoneId);
                console.log(`[Scheduler] Successfully sent to ${recipient.phone}`);
            } else {
                console.warn(`[Scheduler] No starting node content found for ${recipient.phone} in flow "${flow.name}". Check connections after Start node.`);
            }
        } catch (err) {
            console.error(`[Scheduler] Failed to process recipient ${recipient.phone}:`, err.message);
        }
    }

    // 3. Update Schedule
    flow.schedule.lastRun = new Date();

    // Calculate next run
    if (flow.schedule.repeat && flow.schedule.repeat !== 'once') {
        let nextRun = new Date(flow.schedule.nextRun);
        // Ensure nextRun is in the future. If we missed multiple cycles, skip them?
        // This simple logic just adds one interval. 

        if (flow.schedule.repeat === 'daily') {
            nextRun.setDate(nextRun.getDate() + 1);
        } else if (flow.schedule.repeat === 'weekly') {
            nextRun.setDate(nextRun.getDate() + 7);
        } else if (flow.schedule.repeat === 'monthly') {
            nextRun.setMonth(nextRun.getMonth() + 1);
        }

        flow.schedule.nextRun = nextRun;
    } else {
        // Run once: disable or set nextRun to null
        flow.schedule.nextRun = null;
        flow.active = false; // Disable it
    }

    await flow.save();
    console.log(`Updated schedule for flow "${flow.name}". Next run: ${flow.schedule.nextRun}`);
}

/**
 * Execute a scheduled bulk message
 */
async function executeScheduledBulkMessage(scheduledMsg) {
    console.log(`Executing scheduled bulk message ID: ${scheduledMsg._id}`);

    try {
        const { message, recipients, personalize, addDelay } = scheduledMsg;
        let successCount = 0;
        let failCount = 0;

        for (const phone of recipients) {
            try {
                let personalizedMessage = message;

                // Personalize if enabled
                if (personalize) {
                    const lead = await Lead.findOne({ phone });
                    if (lead && lead.name) {
                        personalizedMessage = message
                            .replace(/{name}/g, lead.name)
                            .replace(/{preferred_date}/g, lead.preferred_date || 'your requested date')
                            .replace(/{preferred_time}/g, lead.preferred_time || 'your requested time');
                    } else {
                        personalizedMessage = message
                            .replace(/{name}/g, 'there')
                            .replace(/{preferred_date}/g, 'your requested date')
                            .replace(/{preferred_time}/g, 'your requested time');
                    }
                }

                // Send message
                await sendWhatsAppBusinessMessage(
                    phone,
                    personalizedMessage,
                    process.env.WHATSAPP_TOKEN,
                    process.env.PHONE_NUMBER_ID
                );

                successCount++;
                console.log(`✓ Sent to ${phone}`);

                // Add delay if enabled
                if (addDelay && recipients.indexOf(phone) < recipients.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (err) {
                failCount++;
                console.error(`✗ Failed to send to ${phone}:`, err.message);
            }
        }

        // Update status
        scheduledMsg.status = failCount === recipients.length ? 'failed' : 'sent';
        scheduledMsg.executedAt = new Date();
        await scheduledMsg.save();

        console.log(`Bulk message execution complete. Success: ${successCount}, Failed: ${failCount}`);
    } catch (error) {
        console.error(`Error executing scheduled bulk message ${scheduledMsg._id}:`, error);
        scheduledMsg.status = 'failed';
        scheduledMsg.executedAt = new Date();
        await scheduledMsg.save();
    }
}
