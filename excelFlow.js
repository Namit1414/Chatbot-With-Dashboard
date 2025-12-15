import xlsx from "xlsx";
import path from "path";

const FILE_PATH = path.resolve("./BodyfyStudio_Flows.xlsx");

// Load Excel once with error handling
let rows = [];
try {
  const workbook = xlsx.readFile(FILE_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  rows = xlsx.utils.sheet_to_json(sheet);
  console.log(`✅ Loaded ${rows.length} flows from Excel`);
} catch (error) {
  console.error("⚠️ Error loading Excel file:", error.message);
  console.log("Excel-based flows will not be available.");
}

function normalize(text) {
  return text.toLowerCase().trim();
}

export function getExcelReply(userMessage) {
  // Return null if no Excel data is loaded
  if (!rows || rows.length === 0) {
    return null;
  }

  const msg = normalize(userMessage);

  for (const row of rows) {
    const triggers = row.triggers
      .split(",")
      .map(t => normalize(t));

    for (const trigger of triggers) {
      if (msg.includes(trigger)) {
        return {
          intent: row.intent,
          response: row.response
        };
      }
    }
  }

  return null;
}
