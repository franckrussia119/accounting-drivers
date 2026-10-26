/**
 * v4.31 — Routes API : Fiches de sortie port
 *
 * Flux :  agent au port (rôle agent_port, téléphone)  →  saisit la fiche
 *         → "Soumettre"  →  le bureau (editor / superadmin) vérifie chaque
 *         ligne, complète la partie comptable (recette, pesée, frais de route)
 *         et l'importe en voyage (camion YMT) ou en voyage sous-traité (externe).
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';
import { habitualDriver, todayISO } from '../lib/assignments.js';
import { exchangeInfo } from './trips.js';

export const portRouter = express.Router();

const STAFF = ['superadmin', 'editor'];
const WRITERS = ['superadmin', 'editor', 'agent_port'];
const isStaff = req => STAFF.includes(req.user.role);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toInt = v => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const clean = v => (v === undefined || v === null ? null : String(v).trim() || null);
const upper = v => { const c = clean(v); return c ? c.toUpperCase() : null; };
const norm = v => String(v || '').toUpperCase().replace(/[\s\-_.]/g, '');

// ── Contrôle ISO 6346 (numéro de conteneur : 4 lettres + 6 chiffres + clé) ──
const LETTER_VALUES = (() => {
  const m = {}; let v = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (v % 11 === 0) v++; m[ch] = v; v++; }
  return m;
})();
export function checkContainer(raw) {
  const c = norm(raw);
  if (!c) return { status: 'vide' };
  if (!/^[A-Z]{4}\d{7}$/.test(c)) return { status: 'format', normalized: c, message: 'Format attendu : 4 lettres + 7 chiffres (ex : MSCU1234565)' };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = c[i];
    const val = i < 4 ? LETTER_VALUES[ch] : Number(ch);
    sum += val * Math.pow(2, i);
  }
  const check = (sum % 11) % 10;
  if (check !== Number(c[10])) return { status: 'cle', normalized: c, message: `Clé de contrôle incorrecte (attendu ${check}) — vérifier le numéro` };
  return { status: 'ok', normalized: c };
}

// ── Correspondances camion / chauffeur ─────────────────────────────────────
function matchTruck(input) {
  const n = norm(input);
  if (!n) return null;
  return db.prepare('SELECT code, license_plate, brand_model FROM trucks').all()
    .find(t => norm(t.code) === n || norm(t.license_plate) === n) || null;
}
function matchDriverByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return db.prepare('SELECT id, name FROM drivers').all().find(d => d.name.trim().toLowerCase() === n) || null;
}

function sheetAccess(req, sheet, write = false) {
  if (!sheet) return { code: 404, error: 'Fiche introuvable.' };
  if (req.user.role === 'agent_port') {
    if (sheet.created_by !== req.user.username) return { code: 403, error: 'Cette fiche appartient à un autre agent.' };
    if (write && sheet.status !== 'brouillon') return { code: 409, error: 'Fiche déjà soumise : seule la direction peut la modifier.' };
  }
  if (write && !WRITERS.includes(req.user.role)) return { code: 403, error: 'Accès refusé : droits insuffisants.' };
  if (write && sheet.status === 'valide' && !isStaff(req)) return { code: 409, error: 'Fiche validée : modification impossible.' };
  return null;
}

/** Enrichit les lignes : correspondances, échange, contrôle conteneur, doublons */
function enrichRows(rows, sheetDate) {
  const counts = new Map();
  rows.forEach(r => { const c = norm(r.container_number); if (c) counts.set(c, (counts.get(c) || 0) + 1); });
  const drivers = new Map(db.prepare('SELECT id, name, assigned_truck FROM drivers').all().map(d => [d.id, d]));
  const dupStmt = db.prepare(`
    SELECT id, trip_date, truck_id FROM trips
    WHERE REPLACE(REPLACE(UPPER(container_number),' ',''),'-','') = ? AND trip_date >= date(?, '-45 day') AND (port_row_id IS NULL OR port_row_id <> ?)
    ORDER BY trip_date DESC LIMIT 1`);
  return rows.map(r => {
    const truck = r.is_external ? null : matchTruck(r.truck_code);
    const habitual = truck ? habitualDriver(truck.code) : null;
    const driver = r.driver_id ? drivers.get(r.driver_id) : null;
    const ctn = checkContainer(r.container_number);
    const c = norm(r.container_number);
    const dupTrip = c ? dupStmt.get(c, sheetDate || todayISO(), r.id) : null;
    const isExchange = !r.is_external && (
      (driver && habitual && driver.id !== habitual.id) ||
      (!!r.usual_driver_name && (!driver || r.usual_driver_name.trim().toLowerCase() !== driver.name.trim().toLowerCase()))
    );
    const warnings = [];
    if (!r.is_external && r.truck_code && !truck) warnings.push(`Camion « ${r.truck_code} » inconnu dans la flotte`);
    if (!r.is_external && !r.driver_id) warnings.push(r.driver_name ? `Chauffeur « ${r.driver_name} » non reconnu` : 'Chauffeur non renseigné');
    if (ctn.status === 'format' || ctn.status === 'cle') warnings.push(`Conteneur : ${ctn.message}`);
    if (c && counts.get(c) > 1) warnings.push('Conteneur saisi deux fois sur cette fiche');
    if (dupTrip) warnings.push(`Conteneur déjà en voyage le ${dupTrip.trip_date} (${dupTrip.truck_id})`);
    if (r.is_external && !r.subcontractor_id && !r.external_company) warnings.push('Transporteur externe non précisé');
    return {
      ...r,
      is_external: !!r.is_external,
      matched_truck: truck ? truck.code : null,
      driver_display: driver ? driver.name : (r.driver_name || null),
      habitual_driver_id: habitual ? habitual.id : null,
      habitual_driver_name: habitual ? habitual.name : (r.usual_driver_name || null),
      is_exchange: !!isExchange,
      container_check: ctn.status,
      duplicate_trip: dupTrip || null,
      warnings
    };
  });
}

function sheetTotals(sheetId) {
  return db.prepare(`
    SELECT COUNT(*) AS rows_total,
      SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END) AS rows_pending,
      SUM(CASE WHEN status = 'importe' THEN 1 ELSE 0 END) AS rows_imported,
      SUM(CASE WHEN status = 'rejete' THEN 1 ELSE 0 END) AS rows_rejected,
      SUM(CASE WHEN is_external = 1 THEN 1 ELSE 0 END) AS rows_external,
      COUNT(DISTINCT CASE WHEN is_external = 0 THEN UPPER(truck_code) END) AS trucks_ymt,
      SUM(CASE WHEN container_number IS NOT NULL AND container_number <> '' THEN 1 ELSE 0 END) AS containers,
      COALESCE(SUM(carburant), 0) AS total_carburant,
      COALESCE(SUM(avance), 0) AS total_avance
    FROM port_exit_rows WHERE sheet_id = ?`).get(sheetId);
}

function loadSheet(id) {
  if (!db.prepare('SELECT 1 FROM port_sheets WHERE id = ?').get(id)) return null;
  refreshSheetStatus(id, null); // un voyage supprimé ailleurs peut ré-ouvrir une fiche validée
  const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(id);
  const rows = db.prepare(`
    SELECT r.*, s.name AS subcontractor_name
    FROM port_exit_rows r LEFT JOIN subcontractors s ON s.id = r.subcontractor_id
    WHERE r.sheet_id = ? ORDER BY COALESCE(r.exit_time, '99:99'), r.id`).all(id);
  return { ...sheet, totals: sheetTotals(id), rows: enrichRows(rows, sheet.sheet_date) };
}

function refreshSheetStatus(sheetId, username) {
  const t = sheetTotals(sheetId);
  const sheet = db.prepare('SELECT status FROM port_sheets WHERE id = ?').get(sheetId);
  if (!sheet) return;
  if (username && sheet.status === 'soumis' && t.rows_total > 0 && t.rows_pending === 0) {
    db.prepare(`UPDATE port_sheets SET status = 'valide', validated_by = ?, validated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(username, sheetId);
  } else if (t.rows_pending > 0 && sheet.status === 'valide') {
    db.prepare(`UPDATE port_sheets SET status = 'soumis', validated_by = NULL, validated_at = NULL WHERE id = ?`).run(sheetId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Référentiels (accessibles à l'agent : listes déroulantes)
// ═══════════════════════════════════════════════════════════════════════════
portRouter.get('/refs', (req, res) => {
  try {
    const trucks = db.prepare(`SELECT code, license_plate, brand_model, status FROM trucks ORDER BY code`).all()
      .map(t => ({ ...t, habitual_driver: habitualDriver(t.code)?.name || null, habitual_driver_id: habitualDriver(t.code)?.id || null }));
    const drivers = db.prepare(`SELECT id, name, assigned_truck FROM drivers WHERE is_active = 1 ORDER BY name`).all();
    const subcontractors = db.prepare(`SELECT id, name FROM subcontractors WHERE is_active = 1 ORDER BY name`).all();
    const clients = db.prepare(`
      SELECT name FROM (
        SELECT client_name AS name, MAX(trip_date) AS d FROM trips WHERE client_name IS NOT NULL AND client_name <> '' GROUP BY client_name
        UNION ALL
        SELECT client_name, MAX(created_at) FROM port_exit_rows WHERE client_name IS NOT NULL AND client_name <> '' GROUP BY client_name
      ) GROUP BY UPPER(name) ORDER BY MAX(d) DESC LIMIT 150`).all().map(r => r.name);
    const destinations = db.prepare(`
      SELECT name FROM (
        SELECT route AS name, MAX(trip_date) AS d FROM trips WHERE route IS NOT NULL AND route <> '' GROUP BY route
        UNION ALL
        SELECT destination, MAX(created_at) FROM port_exit_rows WHERE destination IS NOT NULL AND destination <> '' GROUP BY destination
      ) GROUP BY UPPER(name) ORDER BY MAX(d) DESC LIMIT 150`).all().map(r => r.name);
    const ports = db.prepare(`SELECT DISTINCT port FROM port_sheets WHERE port IS NOT NULL AND port <> '' ORDER BY id DESC LIMIT 10`).all().map(r => r.port);
    res.json({ trucks, drivers, subcontractors, clients, destinations, ports, today: todayISO(), user: req.user });
  } catch (err) {
    console.error('Erreur port refs:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des listes.' });
  }
});

// Contrôle d'un numéro de conteneur (saisie en direct sur le téléphone)
portRouter.get('/check-container', (req, res) => {
  const r = checkContainer(req.query.n);
  let dup = null;
  if (r.normalized) {
    dup = db.prepare(`SELECT trip_date, truck_id FROM trips WHERE REPLACE(REPLACE(UPPER(container_number),' ',''),'-','') = ? ORDER BY trip_date DESC LIMIT 1`).get(r.normalized) || null;
  }
  res.json({ ...r, last_trip: dup });
});

// Nombre de fiches à traiter (badge du menu)
portRouter.get('/pending-count', (req, res) => {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS sheets, (SELECT COUNT(*) FROM port_exit_rows r JOIN port_sheets s ON s.id = r.sheet_id WHERE s.status = 'soumis' AND r.status = 'en_attente') AS rows FROM port_sheets WHERE status = 'soumis'`).get();
    res.json(r);
  } catch (err) {
    res.json({ sheets: 0, rows: 0 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Fiches
// ═══════════════════════════════════════════════════════════════════════════
portRouter.get('/sheets', (req, res) => {
  try {
    const { status, startDate, endDate, q } = req.query;
    let sql = 'SELECT * FROM port_sheets WHERE 1=1';
    const p = [];
    if (req.user.role === 'agent_port') { sql += ' AND created_by = ?'; p.push(req.user.username); }
    if (status) { sql += ' AND status = ?'; p.push(status); }
    if (startDate) { sql += ' AND sheet_date >= ?'; p.push(startDate); }
    if (endDate) { sql += ' AND sheet_date <= ?'; p.push(endDate); }
    if (q && q.trim()) {
      sql += ` AND (sheet_no LIKE ? OR agent_name LIKE ? OR port LIKE ? OR id IN (
        SELECT sheet_id FROM port_exit_rows WHERE container_number LIKE ? OR bl_number LIKE ? OR truck_code LIKE ? OR driver_name LIKE ? OR client_name LIKE ?))`;
      const t = `%${q.trim()}%`;
      p.push(t, t, t, t, t, t, t, t);
    }
    sql += ` ORDER BY CASE status WHEN 'soumis' THEN 0 WHEN 'brouillon' THEN 1 ELSE 2 END, sheet_date DESC, id DESC LIMIT 300`;
    const sheets = db.prepare(sql).all(...p).map(s => {
      if (s.status === 'valide') { refreshSheetStatus(s.id, null); s = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(s.id); }
      return { ...s, totals: sheetTotals(s.id) };
    });
    res.json(sheets);
  } catch (err) {
    console.error('Erreur get sheets:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des fiches.' });
  }
});

portRouter.get('/sheets/:id', (req, res) => {
  const sheet = loadSheet(req.params.id);
  const denied = sheetAccess(req, sheet);
  if (denied) return res.status(denied.code).json({ error: denied.error });
  res.json(sheet);
});

portRouter.post('/sheets', requireRole(...WRITERS), (req, res) => {
  try {
    const b = req.body || {};
    const date = isDate(b.sheet_date) ? b.sheet_date : todayISO();
    const prefix = `YMT-PORT-${date.replace(/-/g, '')}-`;
    const n = db.prepare('SELECT COUNT(*) AS c FROM port_sheets WHERE sheet_no LIKE ?').get(prefix + '%').c;
    let i = n + 1, sheetNo;
    do { sheetNo = prefix + String(i).padStart(2, '0'); i++; } while (db.prepare('SELECT 1 FROM port_sheets WHERE sheet_no = ?').get(sheetNo));
    const r = db.prepare(`
      INSERT INTO port_sheets (sheet_no, sheet_date, port, agent_name, agent_phone, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sheetNo, date, clean(b.port), clean(b.agent_name) || req.user.username, clean(b.agent_phone), clean(b.notes), req.user.username);
    logAudit({ username: req.user.username, role: req.user.role, action: 'CREATE', entity: 'port_sheet', entity_id: r.lastInsertRowid, detail: `Fiche sortie port ${sheetNo}`, ip: req.ip });
    res.status(201).json(loadSheet(r.lastInsertRowid));
  } catch (err) {
    console.error('Erreur post sheet:', err);
    res.status(500).json({ error: 'Erreur lors de la création de la fiche.' });
  }
});

portRouter.put('/sheets/:id', requireRole(...WRITERS), (req, res) => {
  const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(req.params.id);
  const denied = sheetAccess(req, sheet, true);
  if (denied) return res.status(denied.code).json({ error: denied.error });
  const b = req.body || {};
  db.prepare(`UPDATE port_sheets SET sheet_date = ?, port = ?, agent_name = ?, agent_phone = ?, notes = ? WHERE id = ?`).run(
    isDate(b.sheet_date) ? b.sheet_date : sheet.sheet_date,
    b.port !== undefined ? clean(b.port) : sheet.port,
    b.agent_name !== undefined ? clean(b.agent_name) : sheet.agent_name,
    b.agent_phone !== undefined ? clean(b.agent_phone) : sheet.agent_phone,
    b.notes !== undefined ? clean(b.notes) : sheet.notes,
    sheet.id);
  res.json(loadSheet(sheet.id));
});

portRouter.delete('/sheets/:id', requireRole(...WRITERS), (req, res) => {
  const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(req.params.id);
  const denied = sheetAccess(req, sheet, true);
  if (denied) return res.status(denied.code).json({ error: denied.error });
  const imported = db.prepare(`SELECT COUNT(*) AS c FROM port_exit_rows WHERE sheet_id = ? AND status = 'importe'`).get(sheet.id).c;
  if (imported > 0) return res.status(409).json({ error: `${imported} ligne(s) déjà importée(s) en voyage : annulez les imports avant de supprimer la fiche.` });
  db.prepare('DELETE FROM port_exit_rows WHERE sheet_id = ?').run(sheet.id);
  db.prepare('DELETE FROM port_sheets WHERE id = ?').run(sheet.id);
  logAudit({ username: req.user.username, role: req.user.role, action: 'DELETE', entity: 'port_sheet', entity_id: sheet.id, detail: `Suppression fiche ${sheet.sheet_no}`, ip: req.ip });
  res.json({ success: true });
});

portRouter.post('/sheets/:id/submit', requireRole(...WRITERS), (req, res) => {
  const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(req.params.id);
  const denied = sheetAccess(req, sheet, true);
  if (denied) return res.status(denied.code).json({ error: denied.error });
  const count = db.prepare('SELECT COUNT(*) AS c FROM port_exit_rows WHERE sheet_id = ?').get(sheet.id).c;
  if (!count) return res.status(400).json({ error: 'La fiche est vide : ajoutez au moins un camion.' });
  db.prepare(`UPDATE port_sheets SET status = 'soumis', submitted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sheet.id);
  logAudit({ username: req.user.username, role: req.user.role, action: 'UPDATE', entity: 'port_sheet', entity_id: sheet.id, detail: `Fiche ${sheet.sheet_no} soumise (${count} sortie(s))`, ip: req.ip });
  res.json(loadSheet(sheet.id));
});

portRouter.post('/sheets/:id/reopen', requireRole(...STAFF), (req, res) => {
  const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(req.params.id);
  if (!sheet) return res.status(404).json({ error: 'Fiche introuvable.' });
  db.prepare(`UPDATE port_sheets SET status = 'brouillon', submitted_at = NULL WHERE id = ?`).run(sheet.id);
  logAudit({ username: req.user.username, role: req.user.role, action: 'UPDATE', entity: 'port_sheet', entity_id: sheet.id, detail: `Fiche ${sheet.sheet_no} renvoyée à l'agent`, ip: req.ip });
  res.json(loadSheet(sheet.id));
});

// ═══════════════════════════════════════════════════════════════════════════
// Lignes (une ligne = un camion sorti)
// ═══════════════════════════════════════════════════════════════════════════
function rowPayload(b, existing = {}) {
  const pick = (k, fn = clean) => (b[k] !== undefined ? fn(b[k]) : existing[k] ?? null);
  const isExt = b.is_external !== undefined ? (b.is_external === true || b.is_external === 1 || b.is_external === '1' || b.is_external === 'true') : !!existing.is_external;
  let truck = pick('truck_code', upper);
  if (truck && !isExt) { const m = matchTruck(truck); if (m) truck = m.code; }
  let driverId = b.driver_id !== undefined ? (parseInt(b.driver_id, 10) || null) : (existing.driver_id ?? null);
  let driverName = pick('driver_name');
  if (!driverId && driverName && !isExt) { const m = matchDriverByName(driverName); if (m) { driverId = m.id; driverName = m.name; } }
  if (driverId) { const d = db.prepare('SELECT name FROM drivers WHERE id = ?').get(driverId); if (d) driverName = d.name; else driverId = null; }
  const ctn = pick('container_number', upper);
  const size = pick('container_size');
  return {
    exit_time: pick('exit_time'),
    truck_code: truck,
    is_external: isExt ? 1 : 0,
    subcontractor_id: isExt ? (b.subcontractor_id !== undefined ? (parseInt(b.subcontractor_id, 10) || null) : existing.subcontractor_id ?? null) : null,
    external_company: isExt ? pick('external_company') : null,
    driver_id: isExt ? null : driverId,
    driver_name: driverName,
    usual_driver_name: isExt ? null : pick('usual_driver_name'),
    bl_number: pick('bl_number', upper),
    container_number: ctn ? norm(ctn) : null,
    container_size: ['20', '40', '45'].includes(String(size)) ? String(size) : null,
    client_name: pick('client_name'),
    destination: pick('destination'),
    carburant: b.carburant !== undefined ? toInt(b.carburant) : (existing.carburant || 0),
    avance: b.avance !== undefined ? toInt(b.avance) : (existing.avance || 0),
    observations: pick('observations')
  };
}

portRouter.post('/sheets/:id/rows', requireRole(...WRITERS), (req, res) => {
  try {
    const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(req.params.id);
    const denied = sheetAccess(req, sheet, true);
    if (denied) return res.status(denied.code).json({ error: denied.error });
    const v = rowPayload(req.body || {});
    if (!v.truck_code && !v.container_number) return res.status(400).json({ error: 'Indiquez au moins le camion ou le numéro de conteneur.' });
    // Idempotence (file d'attente hors-ligne) : même client_uid déjà reçu → renvoyer la ligne
    const uid = clean(req.body?.client_uid);
    if (uid) {
      const dup = db.prepare('SELECT id FROM port_exit_rows WHERE sheet_id = ? AND client_uid = ?').get(sheet.id, uid);
      if (dup) return res.json(loadSheet(sheet.id));
    }
    db.prepare(`
      INSERT INTO port_exit_rows (sheet_id, exit_time, truck_code, is_external, subcontractor_id, external_company, driver_id, driver_name, usual_driver_name,
        bl_number, container_number, container_size, client_name, destination, carburant, avance, observations, created_by, client_uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sheet.id, v.exit_time, v.truck_code, v.is_external, v.subcontractor_id, v.external_company, v.driver_id, v.driver_name, v.usual_driver_name,
      v.bl_number, v.container_number, v.container_size, v.client_name, v.destination, v.carburant, v.avance,
      v.observations, req.user.username, uid);
    refreshSheetStatus(sheet.id, req.user.username);
    res.status(201).json(loadSheet(sheet.id));
  } catch (err) {
    console.error('Erreur post row:', err);
    res.status(500).json({ error: "Erreur lors de l'ajout de la ligne." });
  }
});

function rowWithSheet(rowId) {
  const row = db.prepare('SELECT * FROM port_exit_rows WHERE id = ?').get(rowId);
  if (!row) return { row: null, sheet: null };
  return { row, sheet: db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(row.sheet_id) };
}

portRouter.put('/rows/:id', requireRole(...WRITERS), (req, res) => {
  try {
    const { row, sheet } = rowWithSheet(req.params.id);
    if (!row) return res.status(404).json({ error: 'Ligne introuvable.' });
    const denied = sheetAccess(req, sheet, true);
    if (denied) return res.status(denied.code).json({ error: denied.error });
    if (row.status === 'importe') return res.status(409).json({ error: 'Ligne déjà importée : modifiez le voyage créé, ou annulez l\'import.' });
    const v = rowPayload(req.body || {}, row);
    db.prepare(`
      UPDATE port_exit_rows SET exit_time=?, truck_code=?, is_external=?, subcontractor_id=?, external_company=?, driver_id=?, driver_name=?, usual_driver_name=?,
        bl_number=?, container_number=?, container_size=?, client_name=?, destination=?, carburant=?, avance=?, observations=? WHERE id=?`).run(
      v.exit_time, v.truck_code, v.is_external, v.subcontractor_id, v.external_company, v.driver_id, v.driver_name, v.usual_driver_name,
      v.bl_number, v.container_number, v.container_size, v.client_name, v.destination, v.carburant, v.avance, v.observations, row.id);
    res.json(loadSheet(sheet.id));
  } catch (err) {
    console.error('Erreur put row:', err);
    res.status(500).json({ error: 'Erreur lors de la modification.' });
  }
});

portRouter.delete('/rows/:id', requireRole(...WRITERS), (req, res) => {
  const { row, sheet } = rowWithSheet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ligne introuvable.' });
  const denied = sheetAccess(req, sheet, true);
  if (denied) return res.status(denied.code).json({ error: denied.error });
  if (row.status === 'importe') return res.status(409).json({ error: 'Ligne déjà importée : annulez l\'import d\'abord.' });
  db.prepare('DELETE FROM port_exit_rows WHERE id = ?').run(row.id);
  refreshSheetStatus(sheet.id, req.user.username);
  res.json(loadSheet(sheet.id));
});

// ═══════════════════════════════════════════════════════════════════════════
// Partie BUREAU : import en voyage / rejet / annulation
// ═══════════════════════════════════════════════════════════════════════════
function importRow(row, sheet, b, user) {
  if (row.status === 'importe') throw Object.assign(new Error('Ligne déjà importée.'), { code: 409 });
  const tripDate = isDate(b.trip_date) ? b.trip_date : sheet.sheet_date;
  const route = clean(b.route) || row.destination;
  if (!route) throw Object.assign(new Error('Destination / trajet manquant.'), { code: 400 });
  const recette = toInt(b.recette);
  const notesBase = [`Fiche port ${sheet.sheet_no}`, row.exit_time ? `sortie ${row.exit_time}` : null, row.container_size ? `${row.container_size}'` : null, row.observations || null].filter(Boolean).join(' · ');
  const result = { trip_id: null, sub_trip_id: null, advance_id: null };

  db.exec('BEGIN');
  try {
    if (row.is_external) {
      let subId = parseInt(b.subcontractor_id ?? row.subcontractor_id, 10) || null;
      if (!subId) {
        const name = clean(b.external_company) || row.external_company;
        if (!name) throw Object.assign(new Error('Choisissez le sous-traitant (transporteur externe).'), { code: 400 });
        const found = db.prepare('SELECT id FROM subcontractors WHERE LOWER(name) = LOWER(?)').get(name);
        subId = found ? found.id : db.prepare('INSERT INTO subcontractors (name, notes) VALUES (?, ?)').run(name, 'Créé depuis une fiche sortie port').lastInsertRowid;
      }
      const r = db.prepare(`
        INSERT INTO subcontractor_trips (subcontractor_id, trip_date, destination, goods, bl_number, container_number, client_revenue, subcontractor_cost, notes, created_by, port_row_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        subId, tripDate, route, clean(b.cargo), row.bl_number, row.container_number, recette, toInt(b.subcontractor_cost),
        [notesBase, row.driver_name ? `chauffeur ${row.driver_name}` : null, row.client_name ? `client ${row.client_name}` : null].filter(Boolean).join(' · '),
        user.username, row.id);
      result.sub_trip_id = r.lastInsertRowid;
      db.prepare('UPDATE port_exit_rows SET subcontractor_id = ? WHERE id = ?').run(subId, row.id);
    } else {
      const driverId = parseInt(b.driver_id ?? row.driver_id, 10);
      if (!driverId || !db.prepare('SELECT 1 FROM drivers WHERE id = ?').get(driverId)) throw Object.assign(new Error('Choisissez le chauffeur.'), { code: 400 });
      const truckInput = clean(b.truck_code) || row.truck_code;
      const truck = matchTruck(truckInput);
      if (!truck) throw Object.assign(new Error(`Camion « ${truckInput || '?'} » introuvable : choisissez un camion de la flotte.`), { code: 400 });
      const depCarb = b.dep_carburant !== undefined ? toInt(b.dep_carburant) : toInt(row.carburant);
      const pesee = toInt(b.pesee);
      const peage = toInt(b.peage);
      const remis = depCarb + pesee + peage;
      const ex = exchangeInfo(truck.code, driverId);
      const r = db.prepare(`
        INSERT INTO trips (driver_id, truck_id, trip_date, route, amount_fcfa, recette, marge_nette, dep_carburant, pesee, peage, montant_remis,
          cargo, bl_number, container_number, client_name, notes, usual_driver_id, is_exchange, port_row_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        driverId, truck.code, tripDate, route, remis, recette, recette - remis, depCarb, pesee, peage, remis,
        clean(b.cargo) || (row.container_size ? `Conteneur ${row.container_size}'` : null), row.bl_number, row.container_number,
        clean(b.client_name) || row.client_name, notesBase, ex.usual, ex.isEx, row.id);
      result.trip_id = r.lastInsertRowid;

      const createAdvance = b.create_advance === undefined ? true : !!b.create_advance;
      if (createAdvance && toInt(row.avance) > 0) {
        const a = db.prepare(`
          INSERT INTO driver_advances (driver_id, advance_date, type, amount_fcfa, motif, notes, created_by)
          VALUES (?, ?, 'avance', ?, ?, ?, ?)`).run(driverId, tripDate, toInt(row.avance), `Avance sortie port ${sheet.sheet_no}`, `Voyage #${r.lastInsertRowid} — ${route}`, user.username);
        result.advance_id = a.lastInsertRowid;
      }
      db.prepare('UPDATE port_exit_rows SET driver_id = ?, truck_code = ? WHERE id = ?').run(driverId, truck.code, row.id);
    }
    db.prepare(`UPDATE port_exit_rows SET status = 'importe', trip_id = ?, sub_trip_id = ?, advance_id = ?, reject_reason = NULL WHERE id = ?`)
      .run(result.trip_id, result.sub_trip_id, result.advance_id, row.id);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
  logAudit({
    username: user.username, role: user.role, action: 'CREATE', entity: row.is_external ? 'subcontractor_trip' : 'trip',
    entity_id: result.trip_id || result.sub_trip_id,
    detail: `Import fiche port ${sheet.sheet_no} : ${row.container_number || row.truck_code || ''} → ${route}`, ip: user.ip
  });
  return result;
}

portRouter.post('/rows/:id/import', requireRole(...STAFF), (req, res) => {
  try {
    const { row, sheet } = rowWithSheet(req.params.id);
    if (!row) return res.status(404).json({ error: 'Ligne introuvable.' });
    if (sheet.status === 'brouillon') return res.status(409).json({ error: "La fiche n'a pas encore été soumise par l'agent." });
    const result = importRow(row, sheet, req.body || {}, { ...req.user, ip: req.ip });
    refreshSheetStatus(sheet.id, req.user.username);
    res.json({ ...result, sheet: loadSheet(sheet.id) });
  } catch (err) {
    if (err.code) return res.status(err.code).json({ error: err.message });
    console.error('Erreur import row:', err);
    res.status(500).json({ error: "Erreur lors de l'import." });
  }
});

portRouter.post('/sheets/:id/import-all', requireRole(...STAFF), (req, res) => {
  const sheet = db.prepare('SELECT * FROM port_sheets WHERE id = ?').get(req.params.id);
  if (!sheet) return res.status(404).json({ error: 'Fiche introuvable.' });
  if (sheet.status === 'brouillon') return res.status(409).json({ error: "La fiche n'a pas encore été soumise par l'agent." });
  const items = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const results = [];
  for (const it of items) {
    const row = db.prepare('SELECT * FROM port_exit_rows WHERE id = ? AND sheet_id = ?').get(it.id, sheet.id);
    if (!row || row.status !== 'en_attente') continue;
    try {
      results.push({ id: row.id, ok: true, ...importRow(row, sheet, it, { ...req.user, ip: req.ip }) });
    } catch (e) {
      results.push({ id: row.id, ok: false, error: e.code ? e.message : 'Erreur serveur' });
    }
  }
  refreshSheetStatus(sheet.id, req.user.username);
  res.json({ results, imported: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, sheet: loadSheet(sheet.id) });
});

portRouter.post('/rows/:id/reject', requireRole(...STAFF), (req, res) => {
  const { row, sheet } = rowWithSheet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ligne introuvable.' });
  if (row.status === 'importe') return res.status(409).json({ error: 'Ligne importée : annulez l\'import d\'abord.' });
  db.prepare(`UPDATE port_exit_rows SET status = 'rejete', reject_reason = ? WHERE id = ?`).run(clean(req.body?.reason) || 'Sans motif', row.id);
  refreshSheetStatus(sheet.id, req.user.username);
  logAudit({ username: req.user.username, role: req.user.role, action: 'UPDATE', entity: 'port_sheet', entity_id: sheet.id, detail: `Ligne rejetée (${row.container_number || row.truck_code}) : ${clean(req.body?.reason) || 'sans motif'}`, ip: req.ip });
  res.json(loadSheet(sheet.id));
});

portRouter.post('/rows/:id/restore', requireRole(...STAFF), (req, res) => {
  const { row, sheet } = rowWithSheet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ligne introuvable.' });
  if (row.status !== 'rejete') return res.status(409).json({ error: 'Seule une ligne rejetée peut être restaurée.' });
  db.prepare(`UPDATE port_exit_rows SET status = 'en_attente', reject_reason = NULL WHERE id = ?`).run(row.id);
  refreshSheetStatus(sheet.id, req.user.username);
  res.json(loadSheet(sheet.id));
});

// Annuler un import : supprime le voyage (et l'avance) créés, la ligne repasse "en attente"
portRouter.post('/rows/:id/unimport', requireRole('superadmin'), (req, res) => {
  const { row, sheet } = rowWithSheet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ligne introuvable.' });
  if (row.status !== 'importe') return res.status(409).json({ error: "Cette ligne n'est pas importée." });
  db.exec('BEGIN');
  try {
    if (row.trip_id) db.prepare('DELETE FROM trips WHERE id = ? AND port_row_id = ?').run(row.trip_id, row.id);
    if (row.sub_trip_id) db.prepare('DELETE FROM subcontractor_trips WHERE id = ? AND port_row_id = ?').run(row.sub_trip_id, row.id);
    if (row.advance_id) db.prepare('DELETE FROM driver_advances WHERE id = ?').run(row.advance_id);
    db.prepare(`UPDATE port_exit_rows SET status = 'en_attente', trip_id = NULL, sub_trip_id = NULL, advance_id = NULL WHERE id = ?`).run(row.id);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    return res.status(500).json({ error: "Erreur lors de l'annulation." });
  }
  refreshSheetStatus(sheet.id, req.user.username);
  logAudit({ username: req.user.username, role: req.user.role, action: 'DELETE', entity: 'trip', entity_id: row.trip_id || row.sub_trip_id, detail: `Annulation import fiche ${sheet.sheet_no}`, ip: req.ip });
  res.json(loadSheet(sheet.id));
});
