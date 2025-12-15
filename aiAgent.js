import fetch from "node-fetch";
import "dotenv/config";
import Lead from "./models/Lead.js"; // Import the Lead model

const { OPENROUTER_API_KEY } = process.env;

const persona = `
You are a WhatsApp chatbot for BodyfyStudio.

STRICT RULES:
- DO NOT explain your thinking or reasoning.
- DO NOT use one-word answers. Always reply in friendly, complete sentences.
- DO NOT mention prices, plans, payments, refunds, or policies unless explicitly provided.
- Keep replies conversational and short, like a real person texting.
- When asked what you know about the user, you MUST use the user information provided below to answer.
- When the user gives you the date and time, it is just for the appointment with Bodyfystudio's executive, not for anything else.
- If you are unsure, reply: "Sorry, I couldn’t help with that."

Use this info to answer:
- We offer personalized online fitness coaching.
- We create custom workout and meal plans.
- We have certified trainers who provide 1-on-1 support.
- We focus on sustainable results and building healthy habits.
- IMPORTANT: If the user information below contains a Name, do NOT ask for their name again. Refer to them by name.
`;

// In-memory store for conversation histories
const conversations = {};
const MAX_HISTORY = 10;

// Utility to sanitize phone numbers
function sanitizePhone(phone) {
  if (!phone) return "";
  return phone.replace(/@s\.whatsapp\.net/g, "");
}

export async function aiReply(message, userId) {
  try {
    const sanitizedPhone = sanitizePhone(userId);

    // 1. Fetch user data from the database
    const user = await Lead.findOne({ phone: sanitizedPhone, completed: true });

    // 2. Construct a dynamic persona with the user's data if it exists
    let currentPersona = persona;
    if (user && user.name) {
      currentPersona = `User's Name: ${user.name}\n` + currentPersona;
    }

    if (user) {
      currentPersona += `
      
Here is the FULL information about the user you are talking to:`;
      if (user.name) currentPersona += `
- Name: ${user.name} (ALREADY KNOWN, DO NOT ASK)`;
      if (user.age) currentPersona += `
- Age: ${user.age}`;
      if (user.weight) currentPersona += `
- Weight: ${user.weight} kg`;
      if (user.height) currentPersona += `
- Height: ${user.height} cm`;
      if (user.gender) currentPersona += `
- Gender: ${user.gender}`;
      if (user.place) currentPersona += `
- Place: ${user.place}`;
      if (user.health_issues) currentPersona += `
- Health Issues: ${user.health_issues}`;
      if (user.preferred_date) currentPersona += `
- Preferred Date: ${user.preferred_date}`;
      if (user.preferred_time) currentPersona += `
- Preferred Time: ${user.preferred_time}`;
    }

    // 3. Get or create the user's conversation history
    if (!conversations[sanitizedPhone]) {
      conversations[sanitizedPhone] = [];
    }
    const userHistory = conversations[sanitizedPhone];

    // 4. Ensure the system message is always up-to-date with the latest persona
    if (userHistory.length === 0 || userHistory[0].role !== "system") {
      userHistory.unshift({ role: "system", content: currentPersona });
    } else {
      userHistory[0].content = currentPersona; // Update with latest data
    }

    // 5. Add the new user message to the history
    userHistory.push({ role: "user", content: message });

    // 6. Make the API call
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3-8b-instruct:free",
        messages: userHistory,
      }),
    });

    if (!res.ok) {
      const errorData = await res.text();
      console.error("OpenRouter API Error:", res.status, errorData);
      return "Sorry, I couldn’t help with that.";
    }

    const data = await res.json();

    if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
      console.error("Invalid response structure from OpenRouter API:", data);
      return "Sorry, I couldn’t help with that.";
    }

    const aiMessage = data.choices[0].message.content;
    console.log("🤖 AI reply:", aiMessage);

    // 7. Add AI's reply to history
    userHistory.push({ role: "assistant", content: aiMessage });

    // 8. Trim history to not exceed MAX_HISTORY
    if (userHistory.length > MAX_HISTORY) {
      const systemMessage = userHistory.shift(); // Keep the system message
      while (userHistory.length >= MAX_HISTORY) {
        userHistory.shift(); // Remove oldest messages
      }
      userHistory.unshift(systemMessage); // Add it back to the start
    }

    return aiMessage;
  } catch (e) {
    console.error("Error in aiReply:", e);
    return "Sorry, I couldn’t help with that.";
  }
}
