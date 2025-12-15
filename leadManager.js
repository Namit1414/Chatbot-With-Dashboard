import xlsx from "xlsx";
import path from "path";

const FILE_PATH = path.resolve("./leads.xlsx");

const QUESTIONS = [
  { key: "name", question: "😊 Great! Before we continue, what's your *name*?" },
  { key: "age", question: "📅 How old are you?" },
  { key: "weight", question: "⚖️ What is your current *weight* (in kg)?" },
  { key: "height", question: "📏 What is your *height* (in cm)?" },
  { key: "gender", question: "🚻 What is your *gender*? (Male / Female / Other)" }
];

// In-memory session state
const userStates = {};

function loadWorkbook() {
  try {
    return xlsx.readFile(FILE_PATH);
  } catch {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet([]);
    xlsx.utils.book_append_sheet(wb, ws, "Leads");
    xlsx.writeFile(wb, FILE_PATH);
    return wb;
  }
}

function getAllLeads() {
  const workbook = loadWorkbook();
  const sheet = workbook.Sheets["Leads"];
  return xlsx.utils.sheet_to_json(sheet);
}

export function hasExistingLead(phone) {
  const leads = getAllLeads();
  return leads.some(l => String(l.phone) === String(phone));
}

function saveLead(phone, data) {
  const leads = getAllLeads();

  leads.push({
    phone,
    ...data,
    createdAt: new Date().toISOString()
  });

  const workbook = loadWorkbook();
  const newSheet = xlsx.utils.json_to_sheet(leads);
  workbook.Sheets["Leads"] = newSheet;
  xlsx.writeFile(workbook, FILE_PATH);
}

export function startLeadFlow(phone) {
  userStates[phone] = { step: 0, data: {} };
  return QUESTIONS[0].question;
}

export function handleLeadFlow(phone, message) {
  const state = userStates[phone];
  const currentKey = QUESTIONS[state.step].key;

  state.data[currentKey] = message;
  state.step++;

  if (state.step >= QUESTIONS.length) {
    saveLead(phone, state.data);
    delete userStates[phone];
    return "✅ Thanks! Your details have already been saved. How can I help you further?";
  }

  return QUESTIONS[state.step].question;
}

export function isLeadInProgress(phone) {
  return !!userStates[phone];
}
