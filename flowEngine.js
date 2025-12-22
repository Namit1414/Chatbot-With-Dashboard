import { getExcelReply } from "./excelFlow.js";
import { aiReply } from "./aiAgent.js";
import Flow from "./models/Flow.js";

import {
  isLeadInProgress,
  handleLeadFlow,
  startLeadFlow,
  hasExistingLead
} from "./leadManager.js";
import { executeAdvancedFlow, getFlowSession, personalizeMessage } from "./advancedFlowEngine.js";

export async function runFlow(phone, message) {

  console.log(`[UnifiedHandler] runFlow called for ${phone} msg="${message}"`);

  // 0️⃣ GLOBAL OVERRIDE: Check if this is a NEW USER
  // If not in progress AND not already a lead, force start the lead flow
  if (!isLeadInProgress(phone)) {
    const isRegistered = await hasExistingLead(phone);
    if (!isRegistered) {
      console.log(`[UnifiedHandler] New user detected: ${phone}. Forcing Lead Capture Flow.`);
      return startLeadFlow(phone);
    }
  }

  // 1️⃣ Check Advanced Flows FIRST (Visual Flow Builder flows)
  // This ensures active flow sessions take precedence over legacy lead capture
  const advancedFlowResult = await executeAdvancedFlow(phone, message);
  if (advancedFlowResult) {
    console.log(`[FlowEngine] Advanced Flow Matched. Result Type: ${advancedFlowResult.type}`);
    // Format response based on type
    const formatted = formatAdvancedFlowResponse(advancedFlowResult);
    console.log(`[FlowEngine] Formatted Response:`, JSON.stringify(formatted, null, 2));
    return formatted;
  }

  // 2️⃣ Continue lead flow if active
  if (isLeadInProgress(phone)) {
    return handleLeadFlow(phone, message);
  }

  const msgLower = message.toLowerCase().trim();

  // 3️⃣ Check MongoDB Flows (Simple Keyword Match)
  const flows = await Flow.find({});
  const matchedFlow = flows.find(f => msgLower.includes(f.trigger.toLowerCase()));

  if (matchedFlow) {
    return await personalizeMessage(matchedFlow.response, phone);
  }

  const excel = getExcelReply(message);
  if (excel) {

    // 🔒 Greeting intent (Fallback for already registered users)
    if (excel.intent === "greeting") {
      return "👋 Welcome back! How can I help you today?";
    }

    return await personalizeMessage(excel.response, phone);
  }



  // 5️⃣ AI fallback
  const ai = await aiReply(message, phone);
  if (ai) return ai;

  return "Sorry, I didn't quite understand that. Can you rephrase?";
}

/**
 * Format advanced flow response for WhatsApp API
 */
function formatAdvancedFlowResponse(result) {
  if (!result) return null;

  // For simple text messages
  if (result.type === 'text') {
    return result.content;
  }

  // Flow ended with no response
  if (result.type === 'no_reply') {
    return null;
  }

  // For now, return as structured object for later WhatsApp API integration
  // The server will need to handle these special response types
  return {
    messageType: result.type,
    content: result.content,
    buttons: result.buttons,
    items: result.items,
    sections: result.sections, // ✅ Added sections
    url: result.url,
    caption: result.caption,
    filename: result.filename
  };
}
