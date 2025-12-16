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

const TIME_RANGES = [
  { id: "slot_10_12", title: "10:00 AM - 12:00 PM" },
  { id: "slot_12_02", title: "12:00 PM - 02:00 PM" },
  { id: "slot_02_04", title: "02:00 PM - 04:00 PM" },
  { id: "slot_04_06", title: "04:00 PM - 06:00 PM" },
  { id: "slot_06_08", title: "06:00 PM - 08:00 PM" },
  { id: "slot_08_10", title: "08:00 PM - 10:00 PM" }
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

  // Normalize Time Slot Selection (ID -> Title)
  // If user clicked a list option, we get the ID (e.g. 'slot_10_12'). We want to save the Title.
  if (currentKey === "preferred_time") {
    const selectedRange = TIME_RANGES.find(r => r.id === message);
    if (selectedRange) {
      message = selectedRange.title;
    }
  }

  // Check if the PREVIOUS answer (currentKey) needs validation
  if (currentKey === "preferred_date") {
    if (!isValidDate(message)) {
      // Return error message and stay on same step (don't increment)
      return "⚠️ That doesn't look like a valid date. Please select a date from the list or type it in format YYYY-MM-DD.";
    }
  }

  // Validate Time
  if (currentKey === "preferred_time") {
    if (!isValidTime(message)) {
      return "⚠️ Please select a valid time range from the list OR type a time between 10:00 AM and 10:00 PM.";
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

  // Check if NEXT question is the date or time question, and return List Message if so
  const nextQuestion = questions[state.step];
  if (nextQuestion.key === "preferred_date") {
    return generateDateListMessage(nextQuestion.text);
  }
  if (nextQuestion.key === "preferred_time") {
    return generateTimeListMessage(nextQuestion.text);
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

// Helper to validate time
function isValidTime(input) {
  const timeStr = input.trim();

  // 1. Check if it matches one of our ranges (Simple string match)
  if (timeStr.includes('-') && (timeStr.includes('AM') || timeStr.includes('PM'))) {
    const ranges = TIME_RANGES.map(r => r.title);
    if (ranges.includes(timeStr)) return true;
  }

  // 2. Check if specific valid time (between 10 AM and 10 PM)
  // Formats: "10:30", "10:30 AM", "22:15"
  // Convert to minutes from midnight
  try {
    const timeRegex = /^(\d{1,2})[:.](\d{2})\s?(AM|PM|am|pm)?$/i;
    const match = timeStr.match(timeRegex);

    if (!match) return false;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3] ? match[3].toUpperCase() : null;

    if (minutes < 0 || minutes > 59) return false;

    // Convert to 24h
    if (period) {
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
    }

    // Calculate total minutes
    const totalMinutes = hours * 60 + minutes;

    // Range: 10:00 AM (600 min) to 10:00 PM (1320 min)
    if (totalMinutes >= 600 && totalMinutes <= 1320) {
      return true;
    }
  } catch (e) {
    return false;
  }

  return false;
}

// Helper to generate Time Range List
function generateTimeListMessage(text) {
  return {
    messageType: 'list',
    content: text,
    items: TIME_RANGES.map(r => ({
      id: r.id,
      title: r.title,
      description: "Select this slot"
    }))
  };
}
