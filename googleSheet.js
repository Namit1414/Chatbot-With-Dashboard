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
  await doc.loadInfo(); // loads spreadsheet metadata
  return doc.sheetsByIndex[0]; // first tab
}

export async function saveLead(lead) {
  const sheet = await getSheet();

  await sheet.addRow({
    phone: lead.phone,
    name: lead.name,
    age: lead.age,
    weight: lead.weight,
    height: lead.height,
    gender: lead.gender,
    place: lead.place,
    health_issues: lead.health_issues,
    preferred_date: lead.preferred_date,
    preferred_time: lead.preferred_time,
    createdAt: new Date().toISOString()
  });
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
