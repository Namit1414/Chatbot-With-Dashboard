import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

// Correctly format the private key by replacing the literal '\n' with a newline character.
const key = (process.env.GS_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const auth = new JWT({
  email: process.env.GS_CLIENT_EMAIL,
  key: key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

// Spreadsheet instance
const doc = new GoogleSpreadsheet(
  process.env.GS_SHEET_ID,
  auth
);

async function getSheet() {
  try {
    // Some setups require explicit service account auth
    if (typeof doc.useServiceAccountAuth === "function") {
      try {
        await doc.useServiceAccountAuth({
          client_email: process.env.GS_CLIENT_EMAIL,
          private_key: key
        });
      } catch (e) {
        // ignore, maybe already authenticated via JWT
      }
    }

    await doc.loadInfo(); // loads spreadsheet metadata
    return doc.sheetsByIndex[0]; // first tab
  } catch (e) {
    console.error("Error loading Google Sheet:", e);
    throw e;
  }
}

export async function saveLead(lead) {
  try {
    if (!process.env.GS_SHEET_ID || !process.env.GS_CLIENT_EMAIL || !process.env.GS_PRIVATE_KEY) {
      console.warn("⚠️ Google Sheets credentials missing. Skipping cloud sync.");
      return;
    }

    const sheet = await getSheet();
    const sanitizedPhone = String(lead.phone || "").replace(/@s\.whatsapp\.net/g, "").replace(/\D/g, "");

    const rowData = {
      phone: sanitizedPhone,
      name: lead.name || "N/A",
      age: lead.age || "",
      weight: lead.weight || "",
      height: lead.height || "",
      gender: lead.gender || "",
      place: lead.place || "",
      health_issues: lead.health_issues || "",
      preferred_date: lead.preferred_date || "",
      preferred_time: lead.preferred_time || "",
      createdAt: lead.createdAt || new Date().toISOString()
    };

    await sheet.addRow(rowData);
    console.log(`✅ [GoogleSheet] Row successfully added for ${sanitizedPhone}`);
  } catch (error) {
    console.error(`❌ [GoogleSheet] Failed to add row for ${lead.phone}:`, error.message);
    throw error;
  }
}

export async function findLeadByPhone(phone) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const sanitizedPhone = phone.replace(/@s\.whatsapp\.net/g, "");

    for (const row of rows) {
      if (row.get('phone') === sanitizedPhone) {
        console.log(`Found matching lead in Google Sheet for phone: ${sanitizedPhone}`);
        return {
          phone: row.get('phone'),
          name: row.get('name'),
          age: row.get('age'),
          weight: row.get('weight'),
          height: row.get('height'),
          gender: row.get('gender'),
          place: row.get('place'),
          health_issues: row.get('health_issues'),
          preferred_date: row.get('preferred_date'),
          preferred_time: row.get('preferred_time'),
          completed: true
        };
      }
    }
    return null; // User not found
  } catch (error) {
    console.error("Error finding lead by phone in Google Sheet:", error);
    return null;
  }
}
