
/**
 * WhatsApp Business API Helper
 * Handles sending interactive messages, media, and buttons
 */

/**
 * Send message via WhatsApp Business API
 * Supports: text, buttons, list, image, video, document
 */
export async function sendWhatsAppBusinessMessage(to, messageData, token, phoneNumberId) {
    if (!token || !phoneNumberId) {
        console.error('[WhatsAppAPI] Missing credentials: TOKEN or PHONE_ID not provided.');
        throw new Error('Missing WhatsApp configuration');
    }
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
            case 'video':
            case 'audio':
            case 'document':
                if (messageData.url || messageData.mediaUrl) {
                    requestBody = buildMediaMessage(to, messageData.messageType, messageData);
                } else {
                    requestBody.type = "text";
                    requestBody.text = { body: messageData.caption || messageData.content || `${messageData.messageType} placeholder (No URL provided)` };
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
            console.error('❌ WhatsApp API Error:', JSON.stringify(data, null, 2));
            const errorMsg = data.error?.message || 'Failed to send message';
            const errorCode = data.error?.code || 'UnknownCode';
            const errorSubcode = data.error?.error_subcode || '';
            throw new Error(`WhatsApp API Error (${errorCode}/${errorSubcode}): ${errorMsg}`);
        }

        console.log('✅ WhatsApp message sent successfully:', data.messages?.[0]?.id || 'Success');
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
                            id: btn.id || btn.text.substring(0, 20),
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
    const items = (messageData.items || []).slice(0, 10);
    const sections = messageData.sections || [];

    if (items.length === 0 && sections.length === 0) {
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
                button: messageData.buttonText || "View Menu",
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
    let url = messageData.url || messageData.mediaUrl;

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

    const resObj = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: mediaType,
        [mediaType]: (function () {
            const obj = { link: url };

            // Image and Video support captions. Document does too, but Audio does NOT.
            if (['image', 'video', 'document'].includes(mediaType)) {
                const caption = (messageData.caption || messageData.content || '').toString().trim();
                if (caption.length > 0) {
                    obj.caption = caption;
                }
            }

            // Document requires (or strongly benefits from) a filename
            if (mediaType === 'document') {
                let filename = messageData.filename || 'document.pdf';
                // Sanitize filename: remove spaces and special characters for better delivery
                filename = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
                if (!filename.includes('.')) filename += '.pdf';
                obj.filename = filename;
            }

            return obj;
        })()
    };

    console.log(`[WhatsAppAPI] Payload for ${mediaType}:`, JSON.stringify(resObj, null, 2));
    return resObj;
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

    console.log(`[WhatsAppAPI] Sending to ${to} Payload:`, JSON.stringify(requestBody, null, 2));

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
