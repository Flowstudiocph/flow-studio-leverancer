// ============================================================
// FLOW STUDIO — Google Apps Script Backend
// ============================================================
// TRIN 1: Indsæt dette i script.google.com → Nyt projekt
// TRIN 2: Udfyld CONFIG nedenfor
// TRIN 3: Kør setupSheets() én gang
// TRIN 4: Deploy → Ny deployment → Web App → Anyone
// ============================================================

const CONFIG = {
  SHEET_ID:      '',                  // ID fra dit Google Sheet URL
  NOTIFY_EMAIL:  'din@email.dk',      // Din email til notifikationer
};

// ── CORS + ROUTER ────────────────────────────────────────
function cors(out) {
  return out.setMimeType(ContentService.MimeType.JSON)
    .addHeader('Access-Control-Allow-Origin', '*')
    .addHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .addHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function doGet(e) {
  const a = e.parameter.action;
  try {
    if (a === 'getProject')   return cors(ContentService.createTextOutput(JSON.stringify(getProject(e.parameter.token))));
    if (a === 'getDashboard') return cors(ContentService.createTextOutput(JSON.stringify(getDashboard(e.parameter.adminKey))));
    return cors(ContentService.createTextOutput(JSON.stringify({ error: 'Ukendt handling' })));
  } catch (err) {
    return cors(ContentService.createTextOutput(JSON.stringify({ error: err.message })));
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'logDownload')   return cors(ContentService.createTextOutput(JSON.stringify(logDownload(body))));
    if (body.action === 'createProject') return cors(ContentService.createTextOutput(JSON.stringify(createProject(body))));
    return cors(ContentService.createTextOutput(JSON.stringify({ error: 'Ukendt handling' })));
  } catch (err) {
    return cors(ContentService.createTextOutput(JSON.stringify({ error: err.message })));
  }
}

// ── HENT PROJEKT VIA TOKEN ───────────────────────────────
function getProject(token) {
  const rows = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Projekter').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === token) {
      return {
        ok: true,
        project: {
          id:            rows[i][0],
          token:         rows[i][1],
          clientName:    rows[i][2],
          projectName:   rows[i][3],
          deliveryDate:  rows[i][4],
          includedFiles: JSON.parse(rows[i][5] || '[]'),
          extraFiles:    JSON.parse(rows[i][6] || '[]'),
          pricePerExtra: rows[i][7] || 850,
        }
      };
    }
  }
  return { ok: false, error: 'Ugyldigt token' };
}

// ── LOG DOWNLOAD + EMAIL NOTIFIKATION ───────────────────
function logDownload(body) {
  const { token, projectId, clientName, projectName, files, timestamp } = body;

  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Downloads');
  files.forEach(f => {
    sheet.appendRow([new Date(timestamp), projectId, clientName, projectName, f.name, f.price, token]);
  });

  const total = files.reduce((s, f) => s + f.price, 0);
  const list  = files.map(f => `• ${f.name} — DKK ${f.price}`).join('\n');

  GmailApp.sendEmail(
    CONFIG.NOTIFY_EMAIL,
    `📥 Download: ${clientName} — ${projectName}`,
    `Kunde har hentet ekstra billeder fra Flow Studio leveranceplatform.\n\n` +
    `Kunde: ${clientName}\nProjekt: ${projectName}\nTidspunkt: ${new Date(timestamp).toLocaleString('da-DK')}\n\n` +
    `Downloadede billeder:\n${list}\n\nAt fakturere: DKK ${total}`,
    { name: 'Flow Studio' }
  );

  return { ok: true };
}

// ── OPRET PROJEKT (admin) ────────────────────────────────
function createProject(body) {
  const { adminKey, clientName, projectName, deliveryDate, includedFiles, extraFiles, pricePerExtra } = body;

  if (adminKey !== PropertiesService.getScriptProperties().getProperty('ADMIN_KEY')) {
    return { ok: false, error: 'Ugyldig admin-nøgle' };
  }

  const token     = Utilities.getUuid();
  const projectId = 'PRJ-' + Utilities.getUuid().substring(0, 8).toUpperCase();

  SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Projekter').appendRow([
    projectId, token, clientName, projectName,
    deliveryDate || new Date().toLocaleDateString('da-DK'),
    JSON.stringify(includedFiles  || []),
    JSON.stringify(extraFiles     || []),
    pricePerExtra || 850,
  ]);

  return { ok: true, projectId, token };
}

// ── DASHBOARD (admin) ────────────────────────────────────
function getDashboard(adminKey) {
  if (adminKey !== PropertiesService.getScriptProperties().getProperty('ADMIN_KEY')) {
    return { ok: false, error: 'Ugyldig admin-nøgle' };
  }

  const rows = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Downloads').getDataRange().getValues().slice(1);
  const records = rows.map(r => ({ timestamp: r[0], projectId: r[1], clientName: r[2], projectName: r[3], fileName: r[4], price: Number(r[5]) }));

  const byProject = {};
  records.forEach(r => {
    if (!byProject[r.projectId]) byProject[r.projectId] = { ...r, downloads: [], total: 0 };
    byProject[r.projectId].downloads.push(r);
    byProject[r.projectId].total += r.price;
  });

  return {
    ok: true,
    totalDownloads: records.length,
    totalRevenue:   records.reduce((s, r) => s + r.price, 0),
    recentDownloads: records.slice(-15).reverse(),
    projects: Object.values(byProject).sort((a, b) => new Date(b.downloads[0]?.timestamp) - new Date(a.downloads[0]?.timestamp)),
  };
}

// ── OPSÆTNING: Kør denne én gang ────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  let p = ss.getSheetByName('Projekter');
  if (!p) p = ss.insertSheet('Projekter');
  p.getRange(1,1,1,8).setValues([['Projekt ID','Token','Kundenavn','Projektnavn','Leveringsdato','Inkluderede filer (JSON)','Ekstra filer (JSON)','Pris pr. ekstra']]);

  let d = ss.getSheetByName('Downloads');
  if (!d) d = ss.insertSheet('Downloads');
  d.getRange(1,1,1,7).setValues([['Tidspunkt','Projekt ID','Kundenavn','Projektnavn','Filnavn','Pris','Token']]);

  Logger.log('Flow Studio sheets oprettet ✓');
}
