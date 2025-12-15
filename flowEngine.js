import { getExcelReply } from "./excelFlow.js";
import { aiReply } from "./aiAgent.js";
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

  // 2️⃣ Excel-based flows
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

  // 3️⃣ AI fallback
  const ai = await aiReply(message, phone);
  if (ai) return ai;

  return "Sorry, I didn’t quite understand that. Can you rephrase?";
}
