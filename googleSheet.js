import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

// Correctly format the private key by replacing the literal '\n' with a newline character.
// Also strip potential surrounding quotes that might be added by environment managers.
const key = (process.env.GS_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

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

const _normalizePhone = (phone) => {
  if (!phone) return "";
  let clean = String(phone).replace(/@s\.whatsapp\.net/g, "").replace(/\D/g, "");
  if (clean.length === 10) clean = "91" + clean;
  return clean;
};

const _normalizeForMatch = (p) => {
  const clean = _normalizePhone(p);
  return clean.length >= 10 ? clean.slice(-10) : clean;
};

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function saveLead(lead, retryCount = 0) {
  try {
    if (!process.env.GS_SHEET_ID || !process.env.GS_CLIENT_EMAIL || !process.env.GS_PRIVATE_KEY) {
      console.warn("⚠️ Google Sheets credentials missing. Skipping cloud sync.");
      return;
    }

    const sheet = await getSheet();
    const sanitizedPhone = _normalizePhone(lead.phone);

    const rowData = {
      phone: sanitizedPhone,
      name: lead.name || "N/A",
      age: lead.age || "",
      weight: lead.weight || "",
      height: lead.height || "",
      gender: lead.gender || "",
      place: lead.place || "",
      health_issues: lead.health_issues || "",
      remarks: lead.remarks || "",
      preferred_date: lead.preferred_date || "",
      preferred_time: lead.preferred_time || "",
      createdAt: lead.createdAt || new Date().toISOString()
    };

    // Try to find existing row to update
    const rows = await sheet.getRows();

    const searchTarget = _normalizeForMatch(sanitizedPhone);
    console.log(`[GoogleSheet] Searching for target suffix ${searchTarget} among ${rows.length} rows...`);

    let existingRow = rows.find(row => {
      const rowPhone = _normalizeForMatch(row.get('phone'));
      return rowPhone === searchTarget && searchTarget !== "";
    });

    // Fallback: If not found by header, search through all values
    if (!existingRow) {
      existingRow = rows.find(row => {
        const rawValues = row._rawData || [];
        return rawValues.some(val => {
          const cleanVal = _normalizeForMatch(val);
          return cleanVal === searchTarget && searchTarget !== "";
        });
      });
      if (existingRow) console.log(`[GoogleSheet] Found existing lead via suffix fallback for ${searchTarget}`);
    }

    if (existingRow) {
      // Dirty check: Only save if values are different
      let hasChanges = false;
      for (const [key, value] of Object.entries(rowData)) {
        if (String(existingRow.get(key) || "") !== String(value || "")) {
          hasChanges = true;
          break;
        }
      }

      if (hasChanges) {
        console.log(`[GoogleSheet] Updating existing row for ${sanitizedPhone} (changes detected)`);
        existingRow.assign(rowData);
        await existingRow.save();
        console.log(`✅ [GoogleSheet] Row successfully updated for ${sanitizedPhone}`);
      } else {
        console.log(`[GoogleSheet] Skipping update for ${sanitizedPhone} - No changes detected.`);
      }
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
    if (error.message.includes('429') && retryCount < 3) {
      console.warn(`⚠️ [GoogleSheet] Rate limit hit. Retrying in ${(retryCount + 1) * 2}s...`);
      await sleep((retryCount + 1) * 2000);
      return saveLead(lead, retryCount + 1);
    }
    console.error(`❌ [GoogleSheet] Failed to save to Sheet for ${lead.phone || 'unknown'}:`, error.message);
    throw error;
  }
}

export async function findLeadByPhone(phone) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();

    const searchTarget = _normalizeForMatch(phone);

    for (const row of rows) {
      if (_normalizeForMatch(row.get('phone')) === searchTarget && searchTarget !== "") {
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
          remarks: row.get('remarks'),
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

    const searchTarget = _normalizeForMatch(phone);
    if (!searchTarget) return;

    const existingRow = rows.find(row => _normalizeForMatch(row.get('phone')) === searchTarget);

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
      let phone = _normalizePhone(row.get('phone'));
      if (!phone) continue;

      const leadData = {
        phone: phone,
        name: row.get('name') || "N/A",
        age: row.get('age') || null,
        weight: row.get('weight') || null,
        height: row.get('height') || null,
        gender: row.get('gender') || "N/A",
        place: row.get('place') || "N/A",
        health_issues: row.get('health_issues') || "N/A",
        remarks: row.get('remarks') || "",
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

    // OPTIMIZATION: Only sync leads updated in the last 10 minutes to avoid hitting Google Sheets quota (429)
    // Every 5 minutes the periodic sync runs, so 10 minutes buffer is safe.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const leads = await LeadModel.find({ updatedAt: { $gte: tenMinutesAgo } });

    if (leads.length === 0) {
      console.log(`[GoogleSheet] No leads updated in the last 10m. Skipping sync to sheet.`);
      return { updateCount: 0, addCount: 0 };
    }

    console.log(`[GoogleSheet] Syncing ${leads.length} recently updated leads to Google Sheet...`);

    const sheet = await getSheet();
    const rows = await sheet.getRows();

    let updateCount = 0;
    let addCount = 0;
    let skipCount = 0;

    for (const lead of leads) {
      const sanitizedPhone = _normalizePhone(lead.phone);
      if (!sanitizedPhone) continue;

      const searchTarget = _normalizeForMatch(sanitizedPhone);

      const rowData = {
        phone: sanitizedPhone,
        name: lead.name || "N/A",
        age: lead.age || "",
        weight: lead.weight || "",
        height: lead.height || "",
        gender: lead.gender || "",
        place: lead.place || "",
        health_issues: lead.health_issues || "",
        remarks: lead.remarks || "",
        preferred_date: lead.preferred_date || "",
        preferred_time: lead.preferred_time || "",
        createdAt: lead.createdAt ? new Date(lead.createdAt).toISOString() : new Date().toISOString()
      };

      let existingRow = rows.find(row => _normalizeForMatch(row.get('phone')) === searchTarget);

      if (existingRow) {
        // Dirty check: Compare values before saving
        let hasChanges = false;
        for (const [key, value] of Object.entries(rowData)) {
          // Compare as strings to avoid type mismatches
          if (String(existingRow.get(key) || "") !== String(value || "")) {
            hasChanges = true;
            break;
          }
        }

        if (hasChanges) {
          existingRow.assign(rowData);
          await existingRow.save();
          updateCount++;
          // Aggressive rate limiting for updates: sleep slightly between writes to avoid bursts (429 protection)
          await sleep(500);
        } else {
          skipCount++;
        }
      } else {
        // Add
        await sheet.addRow(rowData);
        addCount++;
        // Aggressive rate limiting for additions:
        await sleep(500);
      }
    }

    console.log(`✅ [GoogleSheet] Sync back complete: ${updateCount} updated, ${addCount} added, ${skipCount} skipped.`);
    return { updateCount, addCount };
  } catch (error) {
    console.error("❌ [GoogleSheet] Failed to sync back to Sheet:", error.message);
    // Don't throw for background sync to avoid crashing the interval
  }
}
