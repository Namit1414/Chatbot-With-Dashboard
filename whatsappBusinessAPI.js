/**
 * WhatsApp Business API Helper
 * Handles sending interactive messages, media, and buttons
 */

/**
 * Send message via WhatsApp Business API
 * Supports: text, buttons, list, image, video, document
 */
export async function sendWhatsAppBusinessMessage(to, messageData, token, phoneNumberId) {
    const baseUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    let requestBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to
    };

    // Handle different message types
    if (typeof messageData === 'string') {
        // Simple text message
        requestBody.type = "text";
        requestBody.text = { body: messageData };
    } else if (messageData.messageType) {
        // Structured message from advanced flow
        switch (messageData.messageType) {
            case 'buttons':
                requestBody = buildButtonsMessage(to, messageData);
                break;
            case 'list':
                requestBody = buildListMessage(to, messageData);
                break;
            case 'image':
                if (messageData.url) {
                    requestBody = buildMediaMessage(to, 'image', messageData);
                } else {
                    requestBody.type = "text";
                    requestBody.text = { body: messageData.caption || 'Image placeholder (No URL provided)' };
                }
                break;
            case 'video':
                if (messageData.url) {
                    requestBody = buildMediaMessage(to, 'video', messageData);
                } else {
                    requestBody.type = "text";
                    requestBody.text = { body: messageData.caption || 'Video placeholder (No URL provided)' };
                }
                break;
            case 'document':
                if (messageData.url) {
                    requestBody = buildDocumentMessage(to, messageData);
                } else {
                    requestBody.type = "text";
                    requestBody.text = { body: messageData.caption || 'Document placeholder (No URL provided)' };
                }
                break;
            default:
                // Fallback to text
                requestBody.type = "text";
                requestBody.text = { body: messageData.content || 'Message' };
        }
    }

    try {
        console.log('[WhatsAppAPI] Sending Payload:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(baseUrl, {
            method: "POST",
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('WhatsApp API Error:', data);
            throw new Error(data.error?.message || 'Failed to send message');
        }

        console.log('✅ WhatsApp message sent:', data);
        return data;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error;
    }
}

/**
 * Build interactive buttons message
 *  WhatsApp supports up to 3 buttons
 */
function buildButtonsMessage(to, messageData) {
    const buttons = (messageData.buttons || []).slice(0, 3); // Max 3 buttons

    // WhatsApp has two types: reply buttons and CTA URLs
    const replyButtons = buttons.filter(b => b.type === 'reply');
    const ctaButtons = buttons.filter(b => b.type === 'url' || b.type === 'call');

    // If we have URL/Call buttons, use CTA template
    if (ctaButtons.length > 0) {
        return {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "interactive",
            interactive: {
                type: "cta_url",
                body: {
                    text: messageData.content || 'Choose an option'
                },
                action: {
                    name: "cta_url",
                    parameters: {
                        display_text: ctaButtons[0].text,
                        url: (function () {
                            let val = ctaButtons[0].value;
                            if (val && val.startsWith('/')) {
                                const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
                                if (baseUrl) {
                                    val = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) + val : baseUrl + val;
                                }
                            }
                            return val;
                        })()
                    }
                }
            }
        };
    }

    // Otherwise use reply buttons
    if (replyButtons.length > 0) {
        return {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: messageData.content || 'Choose an option'
                },
                action: {
                    buttons: replyButtons.map((btn, idx) => ({
                        type: "reply",
                        reply: {
                            id: btn.text.substring(0, 20),  // Use button TEXT as ID!
                            title: btn.text.substring(0, 20) // Max 20 chars
                        }
                    }))
                }
            }
        };
    }

    // Fallback to text if no valid buttons
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: messageData.content }
    };
}

/**
 * Build list message (up to 10 items)
 */
function buildListMessage(to, messageData) {
    const items = (messageData.items || []).slice(0, 10); // Max 10 items

    if (items.length === 0) {
        // Fallback to text
        return {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { body: messageData.content || 'No items available' }
        };
    }

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "list",
            body: {
                text: messageData.content || 'Select an option'
            },
            action: {
                button: messageData.buttonText || "View Options",
                sections: messageData.sections ? messageData.sections.map(sec => ({
                    title: sec.title.substring(0, 24),
                    rows: sec.rows.map(row => ({
                        id: row.id,
                        title: row.title.substring(0, 24),
                        description: row.description ? row.description.substring(0, 72) : ''
                    }))
                })) : [
                    {
                        title: "Options",
                        rows: items.map((item, idx) => ({
                            id: item.id || `item_${idx}`,
                            title: item.title.substring(0, 24), // Max 24 chars
                            description: item.description?.substring(0, 72) // Max 72 chars
                        }))
                    }
                ]
            }
        }
    };
}

/**
 * Build media message (image/video)
 */
function buildMediaMessage(to, mediaType, messageData) {
    let url = messageData.url;

    // Prepend base URL for relative paths (e.g., /uploads/...)
    if (url && url.startsWith('/')) {
        const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
        if (baseUrl) {
            url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) + url : baseUrl + url;
        } else {
            console.warn(`[WhatsAppAPI] Warning: Relative URL detected (${url}) but no PUBLIC_URL or RENDER_EXTERNAL_URL found in environment.`);
        }
    }

    console.log(`[WhatsAppAPI] Final URI for ${mediaType}:`, url);

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: mediaType,
        [mediaType]: {
            link: url,
            caption: messageData.caption || ''
        }
    };
}

/**
 * Build document message
 */
function buildDocumentMessage(to, messageData) {
    let url = messageData.url;

    // Prepend base URL for relative paths
    if (url && url.startsWith('/')) {
        const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
        if (baseUrl) {
            url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) + url : baseUrl + url;
        }
    }

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "document",
        document: {
            link: url,
            caption: messageData.caption || '',
            filename: messageData.filename || 'document.pdf'
        }
    };
}

/**
 * Send template message
 */
export async function sendWhatsAppTemplate(to, templateName, languageCode, components, token, phoneNumberId) {
    const baseUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    const requestBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "template",
        template: {
            name: templateName,
            language: {
                code: languageCode
            },
            components: components || []
        }
    };

    try {
        const response = await fetch(baseUrl, {
            method: "POST",
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('WhatsApp Template API Error:', data);
            throw new Error(data.error?.message || 'Failed to send template');
        }

        return data;
    } catch (error) {
        console.error('Error sending WhatsApp template:', error);
        throw error;
    }
}
