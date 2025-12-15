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

  return questions[state.step].text;
}

export function isLeadInProgress(phone) {
  return !!userStates[phone];
}
