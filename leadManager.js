import Lead from "./models/Lead.js";
import { saveLead } from "./googleSheet.js";

const questions = [
  { key: "name", text: "😊 Great! What's your *name*?" },
  { key: "age", text: "🎂 How old are you?" },
  { key: "weight", text: "⚖️ What is your current *weight* (in kg)?" },
  { key: "height", text: "📏 What is your *height* (in cm)?" },
  { key: "gender", text: "� What is your *gender*? (Male / Female / Other)" },
  { key: "place", text: "📍 Please mention your *place* or *locality*." },
  { key: "health_issues", text: "🏥 Do you have any *health issues*? Please mention if any." },
  { key: "preferred_date", text: "📅 Please tell us your *preferred date* to call you." },
  { key: "preferred_time", text: "⏰ What's your *preferred time* to call you?" }
];

// In-memory session state (still fine for short term, but Redis is better for production)
const userStates = {};

export async function hasExistingLead(phone) {
  const phoneStr = String(phone).trim();
  const lead = await Lead.findOne({ phone: phoneStr, completed: true });
  return !!lead;
}

async function saveLeadToDb(phone, data) {
  try {
    await Lead.findOneAndUpdate(
      { phone },
      { ...data, completed: true, updatedAt: new Date() },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.error("Error saving lead to DB:", e);
  }
}

export function startLeadFlow(phone) {
  userStates[phone] = { step: 0, data: {} };
  return questions[0].text;
}

export async function handleLeadFlow(phone, message) {
  const state = userStates[phone];
  const currentKey = questions[state.step].key;

  // Check if the PREVIOUS answer (currentKey) needs validation
  if (currentKey === "preferred_date") {
    if (!isValidDate(message)) {
      // Return error message and stay on same step (don't increment)
      return "⚠️ That doesn't look like a valid date. Please select a date from the list or type it in format YYYY-MM-DD or 'Today'.";
    }
  }

  state.data[currentKey] = message;
  state.step++;

  if (state.step >= questions.length) {
    await saveLeadToDb(phone, state.data);

    // Try to save to Google Sheet as well (don't block the user on failure)
    try {
      await saveLead({ phone, ...state.data });
    } catch (e) {
      console.error("Failed to save lead to Google Sheet:", e);
    }

    delete userStates[phone];
    return "✅ Thanks! Your details have already been saved. How can I help you further?";
  }

  // Check if NEXT question is the date question, and return List Message if so
  const nextQuestion = questions[state.step];
  if (nextQuestion.key === "preferred_date") {
    return generateDateListMessage(nextQuestion.text);
  }

  return nextQuestion.text;
}

export function isLeadInProgress(phone) {
  return !!userStates[phone];
}

// Helper to validate date
function isValidDate(dateStr) {
  // Check if it's one of our list IDs or titles (optional, but good for safety if we used unique IDs)
  // Simple check: is it a valid date string?
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return true;

  // Allow keywords
  const lower = dateStr.toLowerCase();
  if (lower.includes('today') || lower.includes('tomorrow')) return true;

  return false;
}

// Helper to generate List Message for dates
function generateDateListMessage(text) {
  const items = [];
  const today = new Date();

  // Generate next 7 days
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dateString = d.toDateString(); // e.g. "Fri Dec 17 2025" (Using toDateString for readability)
    // Or simpler format:
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    const title = i === 0 ? "Today" : (i === 1 ? "Tomorrow" : d.toLocaleDateString('en-US', options));

    // ID should be unique-ish
    const id = d.toISOString().split('T')[0]; // YYYY-MM-DD

    items.push({
      id: id,
      title: title,
      description: dateString
    });
  }

  return {
    messageType: 'list',
    content: text,
    items: items
  };
}
