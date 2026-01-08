import express from "express";
import fs from "fs";

const router = express.Router();

// Load flows.json or fallback to internal FLOWS
const FLOWS_FILE = "./flows.json";

function loadFlows() {
  if (fs.existsSync(FLOWS_FILE)) {
    return JSON.parse(fs.readFileSync(FLOWS_FILE, "utf8"));
  }
  return {};
}

function saveFlows(data) {
  fs.writeFileSync(FLOWS_FILE, JSON.stringify(data, null, 2));
}

// GET current flows
router.get("/flows", (req, res) => {
  const flows = loadFlows();
  res.json(flows);
});

// Update flows
router.post("/flows/update", (req, res) => {
  const newFlows = req.body;
  saveFlows(newFlows);
  res.json({ success: true });
});

// Save bot settings
router.post("/settings", (req, res) => {
  fs.writeFileSync("./settings.json", JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// Get bot settings
router.get("/settings", (req, res) => {
  if (fs.existsSync("./settings.json")) {
    res.json(JSON.parse(fs.readFileSync("./settings.json", "utf8")));
  } else {
    res.json({});
  }
});

export default router;
