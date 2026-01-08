import 'dotenv/config';

const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WABA_ID;

const templates = [
    {
        name: "weight_loss_intro",
        category: "MARKETING",
        language: "en_US",
        components: [
            {
                type: "BODY",
                text: "Hi! Ready to transform your life? Join BodyfyStudio for personalized weight loss plans and expert fitness coaching. Visit us at D-260, Central Market, Shastri Nagar, Meerut. Let's get fit together! 💪"
            },
            {
                type: "FOOTER",
                text: "BodyfyStudio - Weight Loss & Fitness"
            },
            {
                type: "BUTTONS",
                buttons: [
                    {
                        type: "QUICK_REPLY",
                        text: "Tell me more"
                    },
                    {
                        type: "QUICK_REPLY",
                        text: "Visit us"
                    }
                ]
            }
        ]
    },
    {
        name: "fitness_follow_up",
        category: "MARKETING",
        language: "en_US",
        components: [
            {
                type: "BODY",
                text: "Hello! We noticed you were interested in our fitness programs. Do you have any questions about our weight loss or nutrition plans? We're here to help you reach your goals! 🏋️‍♂️"
            },
            {
                type: "FOOTER",
                text: "BodyfyStudio Team"
            }
        ]
    },
    {
        name: "social_connect_promo",
        category: "MARKETING",
        language: "en_US",
        components: [
            {
                type: "BODY",
                text: "Stay motivated! Follow BodyfyStudio on Instagram for daily fitness tips, success stories, and nutrition advice. Join our growing community of fitness enthusiasts! ✨"
            },
            {
                type: "FOOTER",
                text: "BodyfyStudio - More than just a gym"
            },
            {
                type: "BUTTONS",
                buttons: [
                    {
                        type: "URL",
                        text: "Follow on Instagram",
                        url: "https://www.instagram.com/bodyfystudio/"
                    }
                ]
            }
        ]
    }
];

async function createTemplates() {
    if (!WABA_ID || !TOKEN) {
        console.error("❌ Error: WABA_ID or WHATSAPP_TOKEN is missing in .env");
        return;
    }

    console.log(`🚀 Starting template creation for WABA ID: ${WABA_ID}...`);

    for (const template of templates) {
        console.log(`\nCreating template: ${template.name}...`);

        try {
            const response = await fetch(`https://graph.facebook.com/v19.0/${WABA_ID}/message_templates`, {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(template)
            });

            const data = await response.json();

            if (data.error) {
                console.error(`❌ Failed to create ${template.name}:`, JSON.stringify(data.error, null, 2));
            } else {
                console.log(`✅ ${template.name} created successfully! ID: ${data.id}`);
            }
        } catch (error) {
            console.error(`❌ Error creating ${template.name}:`, error.message);
        }
    }

    console.log("\n✨ Done! Remember, Meta may take a few minutes to approve these.");
}

createTemplates();
