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
import { runFlow } from "./flowEngine.js";
import Lead from "./models/Lead.js";
import Message from "./models/Message.js";
import Flow from "./models/Flow.js";
import AdvancedFlow from "./models/AdvancedFlow.js";
import { initScheduler } from "./advancedFlowEngine.js";
import { saveLead, findLeadByPhone } from "./googleSheet.js";
import { sendWhatsAppBusinessMessage } from "./whatsappBusinessAPI.js";

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
initScheduler();

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

// Flow APIs
app.get("/api/flows", async (req, res) => {
  const flows = await Flow.find({}).sort({ createdAt: -1 });
  res.json(flows);
});

app.post("/api/flows", async (req, res) => {
  try {
    const { trigger, response } = req.body;
    const flow = new Flow({ trigger: trigger.toLowerCase(), response });
    await flow.save();
    res.json(flow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/flows/:id", async (req, res) => {
  await Flow.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.post("/api/send", async (req, res) => {
  const { to, text } = req.body;
  await sendWhatsAppMessage(to, text, 'dashboard');
  res.sendStatus(200);
});

// Bulk Messaging API
app.post("/api/bulk-send", async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: to, message' });
    }

    // Send message via WhatsApp
    await sendWhatsAppMessage(to, message, 'dashboard');

    console.log(`📤 Bulk message sent to ${to}`);
    res.status(200).json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error in bulk send:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// ========================================
// ADVANCED FLOW BUILDER APIs
// ========================================

// Get all advanced flows
app.get("/api/advanced-flows", async (req, res) => {
  try {
    const flows = await AdvancedFlow.find({}).sort({ updatedAt: -1 });
    res.json(flows);
  } catch (error) {
    console.error('Error fetching advanced flows:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single flow by ID
app.get("/api/advanced-flows/:id", async (req, res) => {
  try {
    const flow = await AdvancedFlow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    res.json(flow);
  } catch (error) {
    console.error('Error fetching flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new advanced flow
app.post("/api/advanced-flows", async (req, res) => {
  try {
    const flowData = req.body;
    const flow = new AdvancedFlow(flowData);
    await flow.save();
    res.status(201).json(flow);
  } catch (error) {
    console.error('Error creating flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update advanced flow
app.put("/api/advanced-flows/:id", async (req, res) => {
  try {
    const flow = await AdvancedFlow.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    res.json(flow);
  } catch (error) {
    console.error('Error updating flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete advanced flow
app.delete("/api/advanced-flows/:id", async (req, res) => {
  try {
    const flow = await AdvancedFlow.findByIdAndDelete(req.params.id);
    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    res.json({ success: true, message: 'Flow deleted' });
  } catch (error) {
    console.error('Error deleting flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle flow active status
app.patch("/api/advanced-flows/:id/toggle", async (req, res) => {
  try {
    const flow = await AdvancedFlow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    flow.active = !flow.active;
    await flow.save();
    res.json(flow);
  } catch (error) {
    console.error('Error toggling flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update flow stats
app.post("/api/advanced-flows/:id/stats", async (req, res) => {
  try {
    const { metric } = req.body; // 'sent', 'delivered', 'read', 'clicked', 'errors'
    const flow = await AdvancedFlow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    if (flow.stats[metric] !== undefined) {
      flow.stats[metric]++;
      await flow.save();
    }
    res.json(flow);
  } catch (error) {
    console.error('Error updating stats:', error);
    res.status(500).json({ error: error.message });
  }
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


    // Unified Flow Handler (Handles Leads, Flows, Excel, and AI)
    // IMPORTANT: 'sanitizedPhone' matches DB records. 'from' is for sending replies.
    const reply = await runFlow(sanitizedPhone, text);
    if (reply) {
      await sendWhatsAppMessage(from, reply, process.env.PHONE_NUMBER_ID);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Error in webhook:", e);
    res.sendStatus(500);
  }
});

async function sendWhatsAppMessage(to, messageData, from) {
  // Extract text content for database storage
  let textContent = '';

  if (typeof messageData === 'string') {
    textContent = messageData;
  } else if (messageData && messageData.content) {
    textContent = messageData.content;
  } else if (messageData && messageData.messageType) {
    textContent = `[${messageData.messageType}] ${messageData.content || ''}`;
  }

  // Save to database
  const message = new Message({ to, from, text: textContent });
  await message.save();
  io.emit('newMessage', message);

  // Send to WhatsApp API using Business API helper
  try {
    await sendWhatsAppBusinessMessage(
      to,
      messageData,
      process.env.WHATSAPP_TOKEN,
      process.env.PHONE_NUMBER_ID
    );
    console.log("✅ WhatsApp message sent successfully");
  } catch (err) {
    console.error("❌ Error sending to WhatsApp:", err);
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
