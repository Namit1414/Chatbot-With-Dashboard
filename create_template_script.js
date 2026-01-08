import 'dotenv/config';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;

// Define the template structure
const newTemplate = {
    name: "bodyfy_welcome_msg", // Updated name to be more unique
    category: "MARKETING",
    allow_category_change: true,
    language: "en_US",
    components: [
        {
            type: "BODY",
            text: "Hello! Thanks for connecting with BodyfyStudio. How can we help you with your fitness journey today?"
        },
        {
            type: "FOOTER",
            text: "BodyfyStudio Team"
        }
    ]
};

async function createTemplate() {
    console.log(`🚀 Creating new template: ${newTemplate.name} ...`);

    try {
        if (!WABA_ID) {
            throw new Error("WABA_ID is missing in .env");
        }
        console.log(`✅ Using WABA ID: ${WABA_ID}`);

        // 2. Create the template
        const createRes = await fetch(`https://graph.facebook.com/v19.0/${WABA_ID}/message_templates`, {
            method: "POST",
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newTemplate)
        });

        const createData = await createRes.json();

        if (createData.error) {
            console.error("❌ Template Creation Failed:", JSON.stringify(createData.error, null, 2));
        } else {
            console.log("✅ Template Created Successfully!");
            console.log("ID:", createData.id);
            console.log("Status:", createData.status);
            console.log("\n⏳ NOTE: Meta takes a few seconds/minutes to approve new templates. Please wait 1-2 minutes before trying to use it.");
        }

    } catch (e) {
        console.error("Script Error:", e.message);
    }
}

createTemplate();
