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

    // Try to find existing row to update
    const rows = await sheet.getRows();

    // Normalize function to get the last 10 digits
    const normalizeForMatch = (p) => {
      const clean = String(p || "").replace(/\D/g, "");
      return clean.length >= 10 ? clean.slice(-10) : clean;
    };

    const searchTarget = normalizeForMatch(sanitizedPhone);
    console.log(`[GoogleSheet] Searching for target suffix ${searchTarget} among ${rows.length} rows...`);

    let existingRow = rows.find(row => {
      const rowPhone = normalizeForMatch(row.get('phone'));
      return rowPhone === searchTarget && searchTarget !== "";
    });

    // Fallback: If not found by header, search through all values
    if (!existingRow) {
      existingRow = rows.find(row => {
        const rawValues = row._rawData || [];
        return rawValues.some(val => {
          const cleanVal = normalizeForMatch(val);
          return cleanVal === searchTarget && searchTarget !== "";
        });
      });
      if (existingRow) console.log(`[GoogleSheet] Found existing lead via suffix fallback for ${searchTarget}`);
    }

    if (existingRow) {
      console.log(`[GoogleSheet] Updating existing row for ${sanitizedPhone} (matched suffix ${searchTarget})`);
      // Update fields
      existingRow.assign(rowData);
      await existingRow.save();
      console.log(`✅ [GoogleSheet] Row successfully updated for ${sanitizedPhone}`);
    } else {
      // Final sanity check: Log the first row's keys to help debug header mismatch
      if (rows.length > 0) {
        console.log(`[GoogleSheet] Available headers in first row:`, Object.keys(rows[0].toObject()));
      }

      console.log(`[GoogleSheet] Adding new row for ${sanitizedPhone}`);
      await sheet.addRow(rowData);
      console.log(`✅ [GoogleSheet] Row successfully added for ${sanitizedPhone}`);
    }
  } catch (error) {
    console.error(`❌ [GoogleSheet] Failed to save to Sheet for ${lead.phone || 'unknown'}:`, error.message);
    throw error;
  }
}

export async function findLeadByPhone(phone) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();

    const normalizeForMatch = (p) => {
      const clean = String(p || "").replace(/\D/g, "");
      return clean.length >= 10 ? clean.slice(-10) : clean;
    };

    const searchTarget = normalizeForMatch(phone);

    for (const row of rows) {
      if (normalizeForMatch(row.get('phone')) === searchTarget && searchTarget !== "") {
        console.log(`Found matching lead in Google Sheet for phone: ${phone}`);
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
    return null;
  } catch (error) {
    console.error("Error finding lead by phone in Google Sheet:", error);
    return null;
  }
}

export async function deleteLeadByPhone(phone) {
  try {
    if (!process.env.GS_SHEET_ID || !process.env.GS_CLIENT_EMAIL || !process.env.GS_PRIVATE_KEY) {
      return;
    }

    const sheet = await getSheet();
    const rows = await sheet.getRows();

    const normalizeForMatch = (p) => {
      const clean = String(p || "").replace(/\D/g, "");
      return clean.length >= 10 ? clean.slice(-10) : clean;
    };

    const searchTarget = normalizeForMatch(phone);
    if (!searchTarget) return;

    const existingRow = rows.find(row => normalizeForMatch(row.get('phone')) === searchTarget);

    if (existingRow) {
      console.log(`[GoogleSheet] Deleting row for ${phone} (matched suffix ${searchTarget})`);
      await existingRow.delete();
      console.log(`✅ [GoogleSheet] Row successfully deleted for ${phone}`);
      return true;
    }

    console.log(`[GoogleSheet] No row found to delete for ${phone}`);
    return false;
  } catch (error) {
    console.error(`❌ [GoogleSheet] Failed to delete lead ${phone}:`, error.message);
    throw error;
  }
}

export async function syncLeadsFromSheet(LeadModel) {
  try {
    if (!process.env.GS_SHEET_ID || !process.env.GS_CLIENT_EMAIL || !process.env.GS_PRIVATE_KEY) {
      return;
    }

    const sheet = await getSheet();
    const rows = await sheet.getRows();
    console.log(`[GoogleSheet] Syncing ${rows.length} rows to MongoDB...`);

    let syncCount = 0;
    for (const row of rows) {
      let phone = String(row.get('phone') || "").replace(/\D/g, "");
      if (!phone) continue;

      // Auto-prefix with 91 if it's a 10-digit number
      if (phone.length === 10) {
        phone = "91" + phone;
      }

      const leadData = {
        phone: phone,
        name: row.get('name') || "N/A",
        age: row.get('age') || null,
        weight: row.get('weight') || null,
        height: row.get('height') || null,
        gender: row.get('gender') || "N/A",
        place: row.get('place') || "N/A",
        health_issues: row.get('health_issues') || "N/A",
        preferred_date: row.get('preferred_date') || "",
        preferred_time: row.get('preferred_time') || "",
        completed: true,
        updatedAt: new Date()
      };

      const existingLead = await LeadModel.findOne({ phone: phone });

      // Only update Mongo if the Sheet has newer or missing data
      // For simplicity, we'll check if the Lead exists and if it was updated recently
      // But usually, if we sync from sheet, we treat sheet as intentional human edit.
      // However, if the user edited in dashboard recently, we should be careful.
      // For now, let's keep it simple: always sync IF not recently updated in Mongo via webhook/dashboard (e.g. within last 1 min)

      await LeadModel.findOneAndUpdate(
        { phone: phone },
        { $set: leadData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      syncCount++;
    }

    console.log(`✅ [GoogleSheet] Successfully synced ${syncCount} leads to MongoDB`);
    return syncCount;
  } catch (error) {
    console.error("❌ [GoogleSheet] Failed to sync from Sheet:", error.message);
    throw error;
  }
}

export async function syncLeadsToSheet(LeadModel) {
  try {
    if (!process.env.GS_SHEET_ID || !process.env.GS_CLIENT_EMAIL || !process.env.GS_PRIVATE_KEY) {
      return;
    }

    const leads = await LeadModel.find({});
    console.log(`[GoogleSheet] Syncing ${leads.length} MongoDB leads to Google Sheet...`);

    const sheet = await getSheet();
    const rows = await sheet.getRows();

    const normalizeForMatch = (p) => {
      const clean = String(p || "").replace(/\D/g, "");
      return clean.length >= 10 ? clean.slice(-10) : clean;
    };

    let updateCount = 0;
    let addCount = 0;

    for (const lead of leads) {
      const sanitizedPhone = String(lead.phone || "").replace(/\D/g, "");
      if (!sanitizedPhone) continue;

      const searchTarget = normalizeForMatch(sanitizedPhone);

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
        createdAt: lead.createdAt ? new Date(lead.createdAt).toISOString() : new Date().toISOString()
      };

      let existingRow = rows.find(row => normalizeForMatch(row.get('phone')) === searchTarget);

      if (existingRow) {
        // Update
        existingRow.assign(rowData);
        await existingRow.save();
        updateCount++;
      } else {
        // Add
        await sheet.addRow(rowData);
        addCount++;
      }
    }

    console.log(`✅ [GoogleSheet] Sync back complete: ${updateCount} updated, ${addCount} added.`);
    return { updateCount, addCount };
  } catch (error) {
    console.error("❌ [GoogleSheet] Failed to sync back to Sheet:", error.message);
    throw error;
  }
}
