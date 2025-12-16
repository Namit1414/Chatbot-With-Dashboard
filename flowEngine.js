import { getExcelReply } from "./excelFlow.js";
import { aiReply } from "./aiAgent.js";
import Flow from "./models/Flow.js";
import ButtonResponse from "./models/ButtonResponse.js";
import {
  isLeadInProgress,
  handleLeadFlow,
  startLeadFlow,
  hasExistingLead
} from "./leadManager.js";
import { executeAdvancedFlow, getFlowSession } from "./advancedFlowEngine.js";

export async function runFlow(phone, message) {

  console.log(`[UnifiedHandler] runFlow called for ${phone} msg="${message}"`);

  // 1️⃣ Check Advanced Flows FIRST (Visual Flow Builder flows)
  // This ensures active flow sessions take precedence over legacy lead capture
  const advancedFlowResult = await executeAdvancedFlow(phone, message);
  if (advancedFlowResult) {
    // If flow is complete (handled but ended), we stop here and return nothing (null)
    // so the AI doesn't pick it up.
    if (advancedFlowResult.type === 'flow_complete') {
      return null;
    }
    // Format response based on type
    return formatAdvancedFlowResponse(advancedFlowResult);
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
    return matchedFlow.response;
  }

  const excel = getExcelReply(message);
  if (excel) {

    // 🔒 Greeting intent
    if (excel.intent === "greeting") {
      // ✅ Already registered user
      if (await hasExistingLead(phone)) {
        return "👋 Welcome back! How can I help you today?";
      }

      // 🆕 New user → start lead capture
      return startLeadFlow(phone);
    }

    return excel.response;
  }

  // 4️⃣ Check Button Automations (Exact ID/Text Match)
  const buttonRule = await ButtonResponse.findOne({ triggerId: message }); // Exact match
  if (buttonRule) {
    console.log(`[UnifiedHandler] Matched Button Automation: ${message}`);
    return buttonRule.responseText;
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
    url: result.url,
    caption: result.caption,
    filename: result.filename
  };
}
