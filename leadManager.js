import Lead from "./models/Lead.js";

const QUESTIONS = [
  { key: "name", question: "😊 Great! Before we continue, what's your *name*?" },
  { key: "age", question: "📅 How old are you?" },
  { key: "weight", question: "⚖️ What is your current *weight* (in kg)?" },
  { key: "height", question: "📏 What is your *height* (in cm)?" },
  { key: "gender", question: "🚻 What is your *gender*? (Male / Female / Other)" }
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
  return QUESTIONS[0].question;
}

export async function handleLeadFlow(phone, message) {
  const state = userStates[phone];
  const currentKey = QUESTIONS[state.step].key;

  state.data[currentKey] = message;
  state.step++;

  if (state.step >= QUESTIONS.length) {
    await saveLeadToDb(phone, state.data);
    delete userStates[phone];
    return "✅ Thanks! Your details have already been saved. How can I help you further?";
  }

  return QUESTIONS[state.step].question;
}

export function isLeadInProgress(phone) {
  return !!userStates[phone];
}
