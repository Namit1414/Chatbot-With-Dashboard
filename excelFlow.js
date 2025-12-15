import xlsx from "xlsx";
import path from "path";

const FILE_PATH = path.resolve("./BodyfyStudio_Flows.xlsx");

// Load Excel once
const workbook = xlsx.readFile(FILE_PATH);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet);

function normalize(text) {
  return text.toLowerCase().trim();
}

export function getExcelReply(userMessage) {
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
