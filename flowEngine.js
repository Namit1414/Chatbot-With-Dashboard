import { getExcelReply } from "./excelFlow.js";
import { aiReply } from "./aiAgent.js";
import Flow from "./models/Flow.js";
import {
  isLeadInProgress,
  handleLeadFlow,
  startLeadFlow,
  hasExistingLead
} from "./leadManager.js";

export async function runFlow(phone, message) {

  // 1️⃣ Continue lead flow if active
  if (isLeadInProgress(phone)) {
    return handleLeadFlow(phone, message);
  }

  const msgLower = message.toLowerCase().trim();

  // 2️⃣ Check MongoDB Flows (Keyword Match)
  // Fetch all flows to check for partial matches (e.g. "price" in "what is the price")
  // Optimization: In a large app, use MongoDB Text Search ($text) instead.
  const flows = await Flow.find({});
  const matchedFlow = flows.find(f => msgLower.includes(f.trigger.toLowerCase()));

  if (matchedFlow) {
    return matchedFlow.response;
  }

  // 3️⃣ Excel-based flows (Legacy support)
  const excel = getExcelReply(message);
  if (excel) {

    // 🔒 Greeting intent
    if (excel.intent === "greeting") {

      // ✅ Already registered user
      if (hasExistingLead(phone)) {
        return "👋 Welcome back! How can I help you today?";
      }

      // 🆕 New user → start lead capture
      return startLeadFlow(phone);
    }

    return excel.response;
  }

  // 4️⃣ AI fallback
  const ai = await aiReply(message, phone);
  if (ai) return ai;

  return "Sorry, I didn’t quite understand that. Can you rephrase?";
}
