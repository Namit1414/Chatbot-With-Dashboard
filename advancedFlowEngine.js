import AdvancedFlow from "./models/AdvancedFlow.js";

// Session management for multi-step flows
const flowSessions = new Map(); // phoneNumber -> { flowId, currentNodeId, variables }

/**
 * Execute advanced flow when triggered
 */
export async function executeAdvancedFlow(phone, message) {
    try {
        // Check if user has an active flow session
        if (flowSessions.has(phone)) {
            return await continueFlow(phone, message);
        }

        // Find matching flow by trigger
        const flows = await AdvancedFlow.find({ active: true });
        const matchedFlow = findMatchingFlow(flows, message);

        if (!matchedFlow) {
            return null; // No flow matched
        }

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
async function startFlow(phone, flow) {
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

    // Update stats
    await updateFlowStats(flow._id, 'sent');

    // Find next node after start
    const nextNode = findNextNode(flow, startNode.id);

    if (!nextNode) {
        endFlowSession(phone);
        return null;
    }

    // Execute next node
    return await executeNode(phone, flow, nextNode);
}

/**
 * Continue existing flow session
 */
async function continueFlow(phone, message) {
    const session = flowSessions.get(phone);

    if (!session) return null;

    // Load flow
    const flow = await AdvancedFlow.findById(session.flowId);

    if (!flow) {
        endFlowSession(phone);
        return null;
    }

    // Get current node
    const currentNode = flow.nodes.find(n => n.id === session.currentNodeId);

    if (!currentNode) {
        endFlowSession(phone);
        return null;
    }

    // Handle user response based on node type
    if (currentNode.type === 'buttons') {
        // Check if user clicked a button
        const clickedButton = currentNode.data.buttons?.find(btn =>
            message.toLowerCase().trim() === btn.value.toLowerCase().trim()
        );

        if (clickedButton) {
            // Track button click
            await updateFlowStats(flow._id, 'clicked');

            // Store in variables if needed
            session.variables.lastButtonClicked = clickedButton.id;
        }
    }

    // Store user response
    session.variables.lastResponse = message;

    // Find next node
    const nextNode = findNextNode(flow, currentNode.id, message, session);

    if (!nextNode) {
        endFlowSession(phone);
        return null;
    }

    // Execute next node
    return await executeNode(phone, flow, nextNode);
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

    // If there's a conditional connection, evaluate it
    for (const connection of connections) {
        if (connection.label) {
            // Conditional branch - check if condition matches
            if (evaluateCondition(connection.label, userMessage, session)) {
                return flow.nodes.find(n => n.id === connection.target);
            }
        }
    }

    // Take first connection (default path)
    const firstConnection = connections[0];
    return flow.nodes.find(n => n.id === firstConnection.target);
}

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
async function executeNode(phone, flow, node) {
    const session = flowSessions.get(phone);

    if (!session) return null;

    // Update session current node
    session.currentNodeId = node.id;
    session.nodeHistory.push(node.id);

    // Execute based on node type
    switch (node.type) {
        case 'message':
            return await executeMessageNode(phone, flow, node);

        case 'buttons':
            return await executeButtonsNode(phone, flow, node);

        case 'list':
            return await executeListNode(phone, flow, node);

        case 'image':
            return await executeImageNode(phone, flow, node);

        case 'video':
            return await executeVideoNode(phone, flow, node);

        case 'document':
            return await executeDocumentNode(phone, flow, node);

        case 'delay':
            return await executeDelayNode(phone, flow, node);

        case 'condition':
            return await executeConditionNode(phone, flow, node);

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
 * Execute list node
 */
async function executeListNode(phone, flow, node) {
    const message = personalizeMessage(node.data.text || '', phone, flowSessions.get(phone));
    const items = node.data.listItems || [];

    await updateFlowStats(flow._id, 'delivered');

    return {
        type: 'list',
        content: message,
        items: items
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
        url: node.data.mediaUrl,
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
        url: node.data.mediaUrl,
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
        url: node.data.mediaUrl,
        filename: node.data.filename || 'document.pdf',
        caption: caption
    };
}

/**
 * Execute delay node
 */
async function executeDelayNode(phone, flow, node) {
    const delayMs = (node.data.delaySeconds || 2) * 1000;

    // Schedule next node execution
    setTimeout(async () => {
        const nextNode = findNextNode(flow, node.id);
        if (nextNode) {
            const result = await executeNode(phone, flow, nextNode);
            if (result) {
                // Send the delayed message (this would need to be handled by the webhook)
                console.log('Delayed message for', phone, ':', result);
            }
        }
    }, delayMs);

    return null; // Don't send anything immediately
}

/**
 * Execute condition node
 */
async function executeConditionNode(phone, flow, node) {
    const session = flowSessions.get(phone);
    const variable = node.data.variable || 'lastResponse';
    const condition = node.data.condition || '';
    const value = session?.variables[variable];

    // Evaluate condition and find appropriate next node
    const nextNode = findNextNode(flow, node.id, value, session);

    if (nextNode) {
        return await executeNode(phone, flow, nextNode);
    }

    return null;
}

/**
 * Personalize message with variables
 */
function personalizeMessage(text, phone, session) {
    let result = text;

    // Replace {phone}
    result = result.replace(/{phone}/g, phone);

    // Replace session variables
    if (session?.variables) {
        Object.keys(session.variables).forEach(key => {
            const regex = new RegExp(`{${key}}`, 'g');
            result = result.replace(regex, session.variables[key] || '');
        });
    }

    return result;
}

/**
 * Update flow statistics
 */
async function updateFlowStats(flowId, metric) {
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
    endFlowSession(phone);
}

/**
 * Get active session info
 */
export function getFlowSession(phone) {
    return flowSessions.get(phone);
}
