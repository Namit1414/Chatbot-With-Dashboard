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
import Campaign from "./models/Campaign.js";
import User from "./models/User.js";
import bcrypt from "bcrypt";

import { initScheduler, startFlow, registerTempFlow } from "./advancedFlowEngine.js";
import { saveLead, findLeadByPhone, deleteLeadByPhone, syncLeadsFromSheet, syncLeadsToSheet } from "./googleSheet.js";
import { sendWhatsAppBusinessMessage, getWhatsAppTemplates, sendWhatsAppTemplate } from "./whatsappBusinessAPI.js";

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

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Find user by username (case-insensitive)
    const normalizedUsername = (username || "").trim();
    const user = await User.findOne({ username: { $regex: new RegExp("^" + normalizedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$", "i") } });

    if (user && await user.comparePassword(password)) {
      req.session.user = user.username;
      // Force admin role if username matches env (case-insensitive)
      const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
      req.session.role = (user.username.toLowerCase() === adminUsername) ? 'admin' : user.role;
      res.json({ success: true });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/api/me', (req, res) => {
  if (req.session.user) {
    const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
    // Case-insensitive check for owner
    const isOwner = req.session.user.toLowerCase() === adminUsername.toLowerCase();

    // Self-healing: Ensure admin role if username matches env
    if (isOwner) {
      req.session.role = 'admin';
    }
    res.json({ username: req.session.user, role: req.session.role, isOwner });
  } else {
    res.status(401).json({ message: 'Not logged in' });
  }
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

// User Management API (Admin only)
app.get('/api/users', async (req, res) => {
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const isOwner = req.session.user?.toLowerCase() === adminUsername;

  if (!isOwner && req.session.role !== 'superadmin') {
    return res.status(403).json({ message: 'Forbidden: Only Owner or Super Admin can manage users' });
  }

  try {
    const users = await User.find({}, '-password').lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const isOwner = req.session.user?.toLowerCase() === adminUsername;

  if (!isOwner && req.session.role !== 'superadmin') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { username, password, role } = req.body;
  try {
    const user = new User({ username, password, role });
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const isOwner = req.session.user?.toLowerCase() === adminUsername;

  if (!isOwner && req.session.role !== 'superadmin') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  try {
    const userToDelete = await User.findById(req.params.id);
    if (!userToDelete) return res.status(404).json({ message: 'User not found' });
    if (userToDelete.username === req.session.user) {
      return res.status(400).json({ message: 'You cannot delete yourself' });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Bootstrap Admin User
async function bootstrapAdmin() {
  try {
    const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
    const adminPassword = (process.env.ADMIN_PASSWORD || 'password123').trim();

    // Search case-insensitively for the admin
    let admin = await User.findOne({ username: { $regex: new RegExp(`^${adminUsername}$`, 'i') } });

    if (!admin) {
      admin = new User({
        username: adminUsername,
        password: adminPassword,
        role: 'admin'
      });
      await admin.save();
      console.log(`✅ Default admin user created: ${adminUsername}`);
    } else {
      // Ensure it has the admin role
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        await admin.save();
        console.log(`⬆️ User ${admin.username} promoted to admin`);
      }
    }
  } catch (error) {
    console.error('❌ Error bootstrapping admin:', error);
  }
}

// Static files with Cache-Control
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // Cache for 1 day
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0'); // Don't cache HTML files
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache JS/CSS/Images
    }
  }
}));


await connectMongo();
await bootstrapAdmin();
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
    const limit = parseInt(req.query.limit) || 1000; // Default to 1000 if not specified
    const skip = parseInt(req.query.skip) || 0;

    console.time("fetchLeads");

    // Use .lean() for better performance as we don't need mongoose documents
    const leads = await Lead.find({})
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .select('phone name age weight height gender place completed unreadMessages updatedAt createdAt remarks health_issues preferred_date preferred_time')
      .lean();

    console.timeEnd("fetchLeads");
    res.json(leads);
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
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before;

  let queryFilter = {
    $or: [
      { from: phone },
      { to: phone }
    ]
  };

  if (before && before !== 'undefined' && before !== 'null') {
    const beforeDate = new Date(before);
    if (!isNaN(beforeDate.getTime())) {
      queryFilter.timestamp = { $lt: beforeDate };
    }
  }


  try {
    const messages = await Message.find(queryFilter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json(messages.reverse());
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: error.message });
  }
});



// Flow APIs
app.get("/api/flows", async (req, res) => {
  const flows = await Flow.find({}).sort({ createdAt: -1 });
  res.json(flows);
});

app.post("/api/flows", async (req, res) => {
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
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
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
  await Flow.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.put("/api/flows/:id", async (req, res) => {
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
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
  try {
    const { to, text, mediaUrl, messageType, filename } = req.body;
    if (mediaUrl) {
      await sendWhatsAppMessage(to, { messageType, url: mediaUrl, caption: text || '', filename }, 'dashboard');
    } else {
      await sendWhatsAppMessage(to, text, 'dashboard');
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error in /api/send:", error);
    res.status(500).json({ error: error.message });
  }
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
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot send bulk messages' });
  try {
    const { to, message, templateName, languageCode, components, campaignId } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Missing required field: to' });
    }

    let apiResponse;
    if (templateName) {
      // Send Template Message
      if (!languageCode) {
        return res.status(400).json({ error: 'Missing languageCode for template' });
      }
      apiResponse = await sendWhatsAppTemplate(to, templateName, languageCode, components, process.env.WHATSAPP_TOKEN, process.env.PHONE_NUMBER_ID);
      console.log(`📤 Bulk template "${templateName}" sent to ${to}`);
    } else if (message) {
      // Send Standard Message
      apiResponse = await sendWhatsAppBusinessMessage(to, message, process.env.WHATSAPP_TOKEN, process.env.PHONE_NUMBER_ID);
      console.log(`📤 Bulk message sent to ${to}`);
    } else {
      return res.status(400).json({ error: 'Must provide either message or templateName' });
    }

    const messageId = apiResponse.messages?.[0]?.id;

    if (campaignId && messageId) {
      await Campaign.findByIdAndUpdate(campaignId, {
        $inc: { sentCount: 1 },
        $push: {
          messages: {
            recipient: to,
            messageId: messageId,
            status: 'sent'
          }
        }
      });
    }

    res.status(200).json({ success: true, message: 'Message sent successfully', messageId });
  } catch (error) {
    console.error('Error in bulk send:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Campaign Endpoints
app.get("/api/campaigns", async (req, res) => {
  try {
    const campaigns = await Campaign.find({}).sort({ createdAt: -1 }).limit(50);
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/campaigns", async (req, res) => {
  try {
    const campaign = new Campaign(req.body);
    await campaign.save();
    res.status(201).json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/campaigns/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/campaigns/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/templates", async (req, res) => {
  try {
    const wabaId = process.env.WABA_ID;
    if (!wabaId) {
      return res.status(500).json({
        error: 'WABA_ID not configured',
        details: 'Please add WABA_ID to your .env file. Find it in Meta Business Manager > WhatsApp Accounts.'
      });
    }

    const templates = await getWhatsAppTemplates(process.env.WHATSAPP_TOKEN, wabaId);
    res.json({ data: templates });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates', details: error.message });
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
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
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
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
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
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
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
  if (req.session.role === 'agent') return res.status(403).json({ error: 'Agents cannot modify flows' });
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
    const changes = req.body.entry?.[0]?.changes?.[0]?.value;

    if (!changes) return res.sendStatus(200);

    // Handle Status Updates (sent, delivered, read, failed)
    if (changes.statuses && changes.statuses[0]) {
      const statusUpdate = changes.statuses[0];
      const status = statusUpdate.status;
      const id = statusUpdate.id;
      const recipient = statusUpdate.recipient_id;

      console.log(`[WhatsAppStatus] Msg ${id} to ${recipient}: ${status}`);

      if (status === 'failed') {
        const errors = statusUpdate.errors;
        console.error(`❌ [WhatsAppDeliveryFailure] Msg ${id} failed. Errors:`, JSON.stringify(errors, null, 2));
        // You could emit this to the UI via socket.io if needed
        io.emit('messageStatus', { id, status, errors });
      } else {
        // sent, delivered, read
        io.emit('messageStatus', { id, status });
      }

      return res.sendStatus(200);
    }

    // Handle Incoming Messages
    const msg = changes.messages?.[0];
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


    // 4. Handle Status Updates
    if (value.statuses && value.statuses.length > 0) {
      const statusUpdate = value.statuses[0];
      const messageId = statusUpdate.id;
      const status = statusUpdate.status; // sent, delivered, read, failed

      console.log(`[Webhook] Status update for ${messageId}: ${status}`);

      // Update Campaign if message belongs to one
      const campaign = await Campaign.findOne({ "messages.messageId": messageId });
      if (campaign) {
        const msgIndex = campaign.messages.findIndex(m => m.messageId === messageId);
        if (msgIndex !== -1) {
          const oldStatus = campaign.messages[msgIndex].status;
          campaign.messages[msgIndex].status = status;

          // Increment counters based on NEW status
          if (status === 'delivered' && oldStatus !== 'delivered' && oldStatus !== 'read') {
            campaign.deliveredCount++;
          } else if (status === 'read' && oldStatus !== 'read') {
            if (oldStatus !== 'delivered') campaign.deliveredCount++;
            campaign.readCount++;
          } else if (status === 'failed' && oldStatus !== 'failed') {
            campaign.failedCount++;
          }

          await campaign.save();
          io.emit('campaignUpdate', { campaignId: campaign._id, status, messageId });
        }
      }
      return res.sendStatus(200);
    }

    // Unified Flow Handler (Handles Leads, Flows, Excel, and AI)
    // IMPORTANT: 'sanitizedPhone' matches DB records. 'from' is for sending replies.
    const reply = await runFlow(sanitizedPhone, text);

    // Track Reply in Campaign
    const campaign = await Campaign.findOne({
      "messages.recipient": sanitizedPhone,
      "createdAt": { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Within last 24h
    }).sort({ createdAt: -1 });

    if (campaign) {
      const msgIndex = campaign.messages.findIndex(m => m.recipient === sanitizedPhone && !m.replied);
      if (msgIndex !== -1) {
        campaign.messages[msgIndex].replied = true;
        campaign.repliedCount++;
        await campaign.save();
        io.emit('campaignUpdate', { campaignId: campaign._id, type: 'reply', recipient: sanitizedPhone });
      }
    }

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

  // Send to WhatsApp API using Business API helper
  try {
    const apiResponse = await sendWhatsAppBusinessMessage(
      to,
      messageData,
      process.env.WHATSAPP_TOKEN,
      process.env.PHONE_NUMBER_ID
    );
    console.log("✅ WhatsApp message sent successfully");

    // Save to database ONLY if sending succeeded
    const message = new Message({ to, from, text: textContent });
    // Optional: store WhatsApp Message ID if available
    // message.whatsappId = apiResponse.messages?.[0]?.id; 
    await message.save();
    io.emit('newMessage', message);

  } catch (err) {
    console.error("❌ Error sending to WhatsApp:", err);
    throw err;
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
