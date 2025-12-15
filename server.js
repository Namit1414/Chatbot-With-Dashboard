import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import "dotenv/config";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import session from "express-session";
import { fileURLToPath } from 'url';

import { connectMongo } from "./models/mongo.js";
import { handleOnboarding } from "./onboarding.js";
import { aiReply } from "./aiAgent.js";
import Lead from "./models/Lead.js";
import Message from "./models/Message.js";
import { saveLead, findLeadByPhone } from "./googleSheet.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(bodyParser.json());

app.use(session({
  secret: 'secret-key-replace-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using https
}));

// Login Routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.user = username;
    res.json({ success: true });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Authentication Middleware
app.use((req, res, next) => {
  // Allow public access to these routes
  if (req.path === '/login' || req.path.startsWith('/webhook')) {
    return next();
  }

  // Check if authenticated
  if (req.session.user) {
    return next();
  }

  // Redirect unauthenticated requests to login
  // If it's an API call, return 401, mostly for frontend, but here redirecting mainly for browser
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

await connectMongo();

function sanitizePhone(phone) {
  if (!phone) return "";
  return phone.replace(/@s\\.whatsapp\\.net/g, "");
}

app.get("/api/leads", async (req, res) => {
  const leads = await Lead.find({}).sort({ updatedAt: -1 });
  res.json(leads);
});

app.post("/api/leads/:phone/read", async (req, res) => {
  const phone = req.params.phone;
  await Lead.updateOne({ phone }, { unreadMessages: 0 });
  res.sendStatus(200);
});

app.get("/api/messages/:phone", async (req, res) => {
  const phone = req.params.phone;
  const messages = await Message.find({ $or: [{ from: phone }, { to: phone }] }).sort({ timestamp: 1 });
  res.json(messages);
});

app.post("/api/send", async (req, res) => {
  const { to, text } = req.body;
  await sendWhatsAppMessage(to, text, 'dashboard');
  res.sendStatus(200);
});


app.get("/debug/leads", async (req, res) => {
  const leads = await Lead.find({});
  res.json(leads);
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";
    const sanitizedPhone = sanitizePhone(from);

    console.log("📩 Incoming:", from, text);

    const message = new Message({ from: sanitizedPhone, to: process.env.PHONE_NUMBER_ID, text });
    await message.save();
    io.emit('newMessage', message);

    const lead = await Lead.findOneAndUpdate(
      { phone: sanitizedPhone },
      { $inc: { unreadMessages: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (lead) {
      io.emit('leadUpdated', lead);
    }

    let completedLead = await Lead.findOne({ phone: sanitizedPhone, completed: true });

    if (!completedLead) {
      const sheetLead = await findLeadByPhone(from);
      if (sheetLead) {
        completedLead = await Lead.findOneAndUpdate(
          { phone: sanitizedPhone },
          sheetLead,
          { upsert: true, new: true }
        );
        console.log(`Lead for ${sanitizedPhone} found in Sheet and restored in MongoDB.`);
      }
    }

    if (completedLead) {
      const reply = await aiReply(text, from);
      if (reply) {
        await sendWhatsAppMessage(from, reply, process.env.PHONE_NUMBER_ID);
      }
    } else {
      const onboardingReply = await handleOnboarding(from, text);
      if (onboardingReply) {
        await sendWhatsAppMessage(from, onboardingReply.text, process.env.PHONE_NUMBER_ID);
        if (onboardingReply.done) {
          await saveLead(onboardingReply.leadData);
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Error in webhook:", e);
    res.sendStatus(500);
  }
});

async function sendWhatsAppMessage(to, text, from) {
  const message = new Message({ to, from, text });
  await message.save();
  io.emit('newMessage', message);

  // Send to WhatsApp API
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      })
    });
    const data = await response.json();
    console.log("WhatsApp API Response:", data);
  } catch (err) {
    console.error("Error sending to WhatsApp:", err);
  }
}

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

httpServer.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Server running")
);