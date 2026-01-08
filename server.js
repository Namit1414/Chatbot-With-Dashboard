import express from "express";
import compression from "compression";
import bodyParser from "body-parser";
import "dotenv/config";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import session from "express-session";
import { fileURLToPath } from 'url';
import multer from 'multer';
import MongoStore from 'connect-mongo';


import { connectMongo } from "./models/mongo.js";
import { runFlow } from "./flowEngine.js";
import Lead from "./models/Lead.js";
import Message from "./models/Message.js";
import Flow from "./models/Flow.js";
import AdvancedFlow from "./models/AdvancedFlow.js";
import ScheduledBulkMessage from "./models/ScheduledBulkMessage.js";

import { initScheduler, startFlow, registerTempFlow } from "./advancedFlowEngine.js";
import { saveLead, findLeadByPhone, deleteLeadByPhone, syncLeadsFromSheet, syncLeadsToSheet } from "./googleSheet.js";
import { sendWhatsAppBusinessMessage } from "./whatsappBusinessAPI.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Enable GZIP compression
app.use(compression());

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

app.use(bodyParser.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-key-replace-in-production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions'
  }),
  cookie: {
    secure: false, // Set to true if using https
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
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
  if (req.path === '/login' || req.path.startsWith('/webhook') || req.path.startsWith('/uploads')) {
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

// Periodic Two-Way Sync (every 5 minutes)
setInterval(async () => {
  try {
    console.log("[Sync] Running periodic Two-Way sync...");
    // 1. Pull from Sheet to MongoDB (Intentional human edits in Sheet come first)
    await syncLeadsFromSheet(Lead);
    // 2. Push from MongoDB to Sheet (Dashboard updates or new leads from Webhook)
    await syncLeadsToSheet(Lead);
    console.log("[Sync] Continuous two-way sync cycle completed.");
  } catch (e) {
    console.error("[Sync] Periodic sync failed:", e.message);
  }
}, 5 * 60 * 1000); // 5 minutes

function sanitizePhone(phone) {
  if (!phone) return "";
  let clean = phone.toString().replace(/\D/g, "");
  if (clean.length === 10) {
    clean = "91" + clean;
  }
  return clean;
}

app.get("/api/leads", async (req, res) => {
  try {
    console.time("fetchLeads");
    // Syncing is now handled periodically or manually via /api/sync
    // to prevent page load delays.

    const leads = await Lead.find({}).sort({ updatedAt: -1 }).lean();

    // Merge duplicates in-memory for the UI if they exist (e.g. 91890... vs 890...)
    const mergedMap = new Map();
    leads.forEach(lead => {
      const s = sanitizePhone(lead.phone);
      if (!mergedMap.has(s)) {
        mergedMap.set(s, lead);
      } else {
        const existing = mergedMap.get(s);
        // Combine unread counts
        existing.unreadMessages = (existing.unreadMessages || 0) + (lead.unreadMessages || 0);
        // Prefer the version with more complete data or more recent update
        if (new Date(lead.updatedAt) > new Date(existing.updatedAt)) {
          Object.assign(existing, lead, {
            unreadMessages: existing.unreadMessages,
            phone: s // Use normalized phone
          });
        }
      }
    });

    const result = Array.from(mergedMap.values());
    console.timeEnd("fetchLeads");
    res.json(result);
  } catch (error) {
    console.error("❌ Error in GET /api/leads:", error);
    res.status(500).json({ error: "Failed to fetch leads", message: error.message });
  }
});

app.post("/api/sync", async (req, res) => {
  try {
    console.log("[ManualSync] Triggered by user...");
    const count = await syncLeadsFromSheet(Lead);
    res.json({ success: true, count });
  } catch (e) {
    console.error("[ManualSync] Failed:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/leads", async (req, res) => {
  try {
    const leadData = req.body;
    if (!leadData.phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const sanitized = sanitizePhone(leadData.phone);
    // Save to DB
    const lead = await Lead.findOneAndUpdate(
      { phone: sanitized },
      { ...leadData, phone: sanitized, completed: true, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    console.log(`[ManualLead] Saved/Updated lead in MongoDB: ${leadData.phone}`);

    // Try to save to Google Sheet
    try {
      // Use the normalized database object for Google Sheets
      await saveLead(lead.toObject());
      console.log(`[ManualLead] Successfully synced to Google Sheet: ${leadData.phone}`);
    } catch (e) {
      console.error(`[ManualLead] CRITICAL: Failed to save to Google Sheet for ${leadData.phone}:`, e.message);
    }

    res.status(201).json(lead);
  } catch (error) {
    console.error("Error creating manual lead:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/leads/:phone/read", async (req, res) => {
  const phone = sanitizePhone(req.params.phone);
  await Lead.updateOne({ phone }, { unreadMessages: 0 });
  res.sendStatus(200);
});

app.put("/api/leads/id/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    if (data.phone) data.phone = sanitizePhone(data.phone);

    const lead = await Lead.findByIdAndUpdate(
      id,
      { ...data, updatedAt: new Date() },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    // Sync update to Google Sheet
    try {
      await saveLead(lead.toObject());
      console.log(`[LeadUpdate] Successfully synced update to Google Sheet: ${lead.phone}`);
    } catch (e) {
      console.error(`[LeadUpdate] Failed to sync update to Google Sheet for ${lead.phone}:`, e.message);
    }

    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/leads/id/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[Archive] Attempting to delete lead with ID: ${id}`);
    const lead = await Lead.findByIdAndDelete(id);
    if (!lead) {
      console.warn(`[Archive] Lead not found for ID: ${id}`);
      return res.status(404).json({ error: "Lead not found" });
    }

    // Sync deletion to Google Sheet
    try {
      await deleteLeadByPhone(lead.phone);
      console.log(`[Archive] Successfully synced deletion to Google Sheet: ${lead.phone}`);
    } catch (e) {
      console.error(`[Archive] Failed to sync deletion to Google Sheet for ${lead.phone}:`, e.message);
    }

    console.log(`[Archive] Successfully deleted lead: ${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[Archive] Error deleting lead:`, error);
    res.status(500).json({ error: error.message });
  }
});




app.get("/api/messages/:phone", async (req, res) => {
  const phone = sanitizePhone(req.params.phone);
  const suffix = phone.slice(-10);
  const limit = parseInt(req.query.limit) || 0;

  // Fetch messages that match the full phone or the last 10 digits (fallback for inconsistently saved numbers)
  let query = Message.find({
    $or: [
      { from: phone },
      { to: phone },
      { from: { $regex: suffix + "$" } },
      { to: { $regex: suffix + "$" } }
    ]
  });

  if (limit > 0) {
    // Get latest messages and reverse them to display in chronological order
    const latestMessages = await Message.find({
      $or: [
        { from: phone },
        { to: phone },
        { from: { $regex: suffix + "$" } },
        { to: { $regex: suffix + "$" } }
      ]
    }).sort({ timestamp: -1 }).limit(limit);

    return res.json(latestMessages.reverse());
  }

  const messages = await query.sort({ timestamp: 1 });
  res.json(messages);
});

// Flow APIs
app.get("/api/flows", async (req, res) => {
  const flows = await Flow.find({}).sort({ createdAt: -1 });
  res.json(flows);
});

app.post("/api/flows", async (req, res) => {
  try {
    console.log('Creating new simple flow:', req.body);
    const { trigger, response } = req.body;
    const flow = new Flow({ trigger: trigger.toLowerCase(), response });
    await flow.save();
    console.log('Simple flow saved successfully:', flow._id);
    res.json(flow);
  } catch (e) {
    console.error('Error creating simple flow:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/flows/:id", async (req, res) => {
  await Flow.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.put("/api/flows/:id", async (req, res) => {
  try {
    console.log(`[FlowUpdate] Attempting to update flow with ID: "${req.params.id}"`);
    console.log(`[FlowUpdate] Request body:`, req.body);

    const { trigger, response } = req.body;
    const flow = await Flow.findByIdAndUpdate(
      req.params.id,
      { trigger: trigger.toLowerCase(), response },
      { new: true }
    );
    if (!flow) {
      console.warn(`[FlowUpdate] Flow not found in database for ID: "${req.params.id}"`);
      // Check if it exists in AdvancedFlow instead by mistake?
      const isAdvanced = await AdvancedFlow.findById(req.params.id);
      if (isAdvanced) {
        console.warn(`[FlowUpdate] Warning: This ID belongs to an AdvancedFlow, not a Simple Flow.`);
        return res.status(404).json({ error: 'This is an advanced flow. Please edit it in the Flow Builder.', type: 'advanced_mismatch' });
      }
      return res.status(404).json({ error: `Flow not found for ID: ${req.params.id}` });
    }
    console.log('Simple flow updated successfully:', flow._id);
    res.json(flow);
  } catch (e) {
    console.error('Error updating simple flow:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/send", async (req, res) => {
  const { to, text, mediaUrl, messageType, filename } = req.body;
  if (mediaUrl) {
    await sendWhatsAppMessage(to, { messageType, url: mediaUrl, caption: text || '', filename }, 'dashboard');
  } else {
    await sendWhatsAppMessage(to, text, 'dashboard');
  }
  res.sendStatus(200);
});

// Cloudinary Configuration
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// File Upload API (Now using Cloudinary for permanent storage)
app.post("/api/upload", upload.single('file'), async (req, res) => {
  console.log("📁 Permanent upload request received");

  if (!req.file) {
    console.error("❌ No file in request");
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Determine folder and resource_type based on file type
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');
    const isPdf = req.file.mimetype === 'application/pdf';

    const folder = isImage ? 'bot-images' : (isVideo ? 'bot-videos' : 'bot-documents');

    // For PDFs, 'raw' is technically the most correct type in Cloudinary
    const resourceType = (isImage || isVideo) ? 'auto' : 'raw';

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: folder,
      resource_type: resourceType,
      type: "upload",
      access_mode: "public",
      invalidate: true
    });

    console.log(`✅ Cloudinary upload successful: ${result.secure_url}`);

    let finalUrl = result.secure_url;

    // Self-test accessibility before returning to UI
    try {
      const testRes = await fetch(finalUrl, { method: 'GET' });
      if (testRes.status === 401 || testRes.status === 403) {
        console.error(`❌ Cloudinary Access Denied (Status: ${testRes.status}). Account security is blocking public links.`);

        // AUTOMATIC FALLBACK: Use local server URL if Cloudinary is blocked
        const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
        if (baseUrl) {
          const localPath = `/uploads/${path.basename(req.file.path)}`;
          finalUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) + localPath : baseUrl + localPath;
          console.log(`🚀 AUTOMATIC FALLBACK: Using Local Server URL: ${finalUrl}`);
        } else {
          console.warn(`⚠️ No PUBLIC_URL found. Fallback impossible. File might be undeliverable.`);
        }
      } else {
        console.log(`🌐 Verified: Publicly accessible via Cloudinary`);
      }
    } catch (e) {
      console.warn(`⚠️ Access check failed: ${e.message}`);
    }

    res.json({
      url: finalUrl,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      public_id: result.public_id
    });
  } catch (error) {
    console.error("❌ Cloudinary Upload Error:", error);
    res.status(500).json({ error: 'Failed to upload to permanent storage', details: error.message });
  }
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

// Schedule bulk message
app.post("/api/bulk-messages/schedule", async (req, res) => {
  try {
    const { message, recipients, scheduledTime, personalize, addDelay } = req.body;

    if (!message || !recipients || !scheduledTime) {
      return res.status(400).json({ error: 'Missing required fields: message, recipients, scheduledTime' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Recipients must be a non-empty array' });
    }

    const scheduledMessage = new ScheduledBulkMessage({
      message,
      recipients,
      scheduledTime: new Date(scheduledTime),
      personalize: personalize || false,
      addDelay: addDelay !== undefined ? addDelay : true
    });

    await scheduledMessage.save();
    console.log(`📅 Bulk message scheduled for ${scheduledTime} to ${recipients.length} recipients`);

    res.status(201).json({
      success: true,
      message: 'Bulk message scheduled successfully',
      scheduledMessage
    });
  } catch (error) {
    console.error('Error scheduling bulk message:', error);
    res.status(500).json({ error: 'Failed to schedule message', details: error.message });
  }
});

// Get all scheduled bulk messages (optional - for future UI)
app.get("/api/bulk-messages/scheduled", async (req, res) => {
  try {
    const scheduledMessages = await ScheduledBulkMessage.find({ status: 'pending' })
      .sort({ scheduledTime: 1 });
    res.json(scheduledMessages);
  } catch (error) {
    console.error('Error fetching scheduled messages:', error);
    res.status(500).json({ error: error.message });
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
    console.log('Creating new advanced flow:', req.body.name);
    const flowData = req.body;
    const flow = new AdvancedFlow(flowData);
    await flow.save();
    console.log('Advanced flow created successfully:', flow._id);
    res.status(201).json(flow);
  } catch (error) {
    console.error('Error creating advanced flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update advanced flow
app.put("/api/advanced-flows/:id", async (req, res) => {
  try {
    console.log('Updating advanced flow:', req.params.id, req.body.name);
    const flow = await AdvancedFlow.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!flow) {
      console.warn('Advanced flow not found for update:', req.params.id);
      return res.status(404).json({ error: 'Flow not found' });
    }
    console.log('Advanced flow updated successfully:', flow._id);
    res.json(flow);
  } catch (error) {
    console.error('Error updating advanced flow:', error);
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
    const sanitizedPhone = sanitizePhone(from);
    let text = "";

    // Handle different message types
    if (msg.type === "text") {
      text = msg.text?.body || "";
    } else if (msg.type === "interactive") {
      // Handle button clicks and list selections
      if (msg.interactive.type === "button_reply") {
        // Use ID (payload) as the primary value to match against button value
        text = msg.interactive.button_reply.id;
      } else if (msg.interactive.type === "list_reply") {
        text = msg.interactive.list_reply.id;
      }
    }

    console.log("📩 Incoming:", from, text, `[${msg.type}]`);

    const message = new Message({ from: sanitizedPhone, to: process.env.PHONE_NUMBER_ID, text, messageType: msg.type });
    await message.save();
    io.emit('newMessage', message);

    const lead = await Lead.findOneAndUpdate(
      { phone: sanitizedPhone },
      { $inc: { unreadMessages: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (lead) {
      io.emit('leadUpdated', lead);
      // Immediate sync to Google Sheet for new/active leads
      saveLead(lead.toObject()).catch(e => console.error("[Sync] Webhook lead sync failed:", e.message));
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

// Test Flow API
app.post("/api/test-flow", async (req, res) => {
  try {
    const { phone, flowId, flowData } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const sanitizedPhone = sanitizePhone(phone);
    let flowToRun;

    if (flowId) {
      flowToRun = await AdvancedFlow.findById(flowId);
    } else if (flowData) {
      // Construct a temporary flow object
      flowToRun = {
        _id: 'temp_test_' + Date.now(),
        nodes: flowData.nodes || [],
        connections: flowData.connections || [],
        trigger: 'test',
        triggerType: 'exact',
        stats: { sent: 0, delivered: 0, read: 0, clicked: 0, errors: 0 }
      };
      // Register temp flow so continueFlow can find it later
      registerTempFlow(flowToRun);
    }

    if (!flowToRun) {
      return res.status(404).json({ error: 'Flow not found or invalid data' });
    }

    // Run flow
    const result = await startFlow(sanitizedPhone, flowToRun);

    // Send initial message if any
    if (result) {
      let msgToSend = result;
      if (result.type && !result.messageType) {
        msgToSend = { ...result, messageType: result.type };
      }
      await sendWhatsAppBusinessMessage(sanitizedPhone, msgToSend, process.env.WHATSAPP_TOKEN, process.env.PHONE_NUMBER_ID);
    }

    res.json({ success: true, message: 'Flow started for ' + sanitizedPhone });
  } catch (error) {
    console.error('Test flow error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function sendWhatsAppMessage(to, messageData, from) {
  // Extract text content for database storage
  let textContent = '';

  if (typeof messageData === 'string') {
    textContent = messageData;
  } else if (messageData && messageData.messageType) {
    const mediaInfo = messageData.url || '';
    const caption = messageData.caption || messageData.content || '';
    textContent = `[${messageData.messageType}] ${mediaInfo} ${caption}`.trim();
  } else if (messageData && messageData.content) {
    textContent = messageData.content;
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
