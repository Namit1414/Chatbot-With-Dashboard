import Lead from "./models/Lead.js";

const sessions = {};

const questions = [
  { key: "name", text: "😊 Great! What's your name?" },
  { key: "age", text: "🎂 How old are you?" },
  { key: "weight", text: "⚖️ Your current weight (kg)?" },
  { key: "height", text: "📏 Your height (cm)?" },
  { key: "gender", text: "👤 Your gender? (Male / Female / Other)" },
  { key: "place", text: "Please mention your place or locality." },
  { key: "health_issues", text: "Do You Have Any Health Issues? Please Mention If Any." },
  { key: "preferred_date", text: "Please tell us your preferred Date to call you." },
  { key: "preferred_time", text: "Preferred Time to call you?" }
];

// Utility to sanitize phone numbers
function sanitizePhone(phone) {
  return phone.replace(/@s\.whatsapp\.net/g, "");
}

export async function handleOnboarding(phone, text) {
  const sanitizedPhone = sanitizePhone(phone);

  // ✅ Start session if it doesn't exist
  if (!sessions[sanitizedPhone]) {
    sessions[sanitizedPhone] = {
      step: 0,
      data: { phone: sanitizedPhone }
    };

    return {
      text: questions[0].text,
      done: false
    };
  }

  const session = sessions[sanitizedPhone];
  const currentQuestion = questions[session.step];

  // ✅ Save answer
  session.data[currentQuestion.key] = text.trim();
  session.step++;

  // ✅ Ask next question
  if (session.step < questions.length) {
    return {
      text: questions[session.step].text,
      done: false
    };
  }

  // ✅ FINAL SAVE (DB ONLY)
  const leadData = {
    ...session.data,
    completed: true
  };

  await Lead.findOneAndUpdate(
    { phone: sanitizedPhone },
    leadData,
    { upsert: true, new: true }
  );

  // ✅ Clear memory
  delete sessions[sanitizedPhone];

  // ✅ Return final data to be saved by the server
  return {
    text: "✅ Thanks! Your details are saved. Our team will contact you shortly 💪",
    done: true,
    leadData: leadData // Pass the data back for the server to handle sheet saving
  };
}
