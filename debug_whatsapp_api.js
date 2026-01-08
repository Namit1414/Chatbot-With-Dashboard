import 'dotenv/config';
import fetch from 'node-fetch';

const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;

if (!token || !phoneNumberId) {
    console.error('Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID in .env');
    process.exit(1);
}

const baseUrl = 'https://graph.facebook.com/v19.0';

async function testEndpoint(name, url) {
    console.log(`\n--- Testing ${name} ---`);
    console.log(`URL: ${url}`);
    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        console.log(`Status: ${res.status}`);
        console.log('Response:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
}

async function runDebug() {
    console.log('Starting API Debug...');

    // 1. Basic Phone Number Info
    await testEndpoint('Basic Phone Info', `${baseUrl}/${phoneNumberId}?fields=id,display_phone_number,verified_name`);

    // 2. Business Profile (might link to account?)
    await testEndpoint('Business Profile', `${baseUrl}/${phoneNumberId}/business_profile?fields=id,websites,email`);

    // 3. User / Me info
    // If the token is a system user or admin, 'me' might show businesses
    await testEndpoint('Me / Token Info', `${baseUrl}/me?fields=id,name`);

    // 4. Me Accounts
    await testEndpoint('Me Accounts', `${baseUrl}/me/accounts?fields=id,name,category`);

    // 5. Shared WABA?
    // Sometimes WABA ID is accessible if we know the Business ID.
    // Try to find Business ID from /me/businesses
    await testEndpoint('Me Businesses', `${baseUrl}/me/businesses`);

    // 6. Direct guess? (Using invalid field intentionally to see if error suggestions appear? No, we saw the error already)

    console.log('\n--- End Debug ---');
}

runDebug();
