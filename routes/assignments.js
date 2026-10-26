/**
 * v4.31 — Routes API : Affectations & échanges camion ↔ chauffeur
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';
import { REASONS, resolveDriver, findOverlap, todayISO, activeAssignmentForDriver } from '../lib/assignments.js';

export const assignmentsRouter = express.Router();

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function withNames(rows) {
  const habit = new Map();
  db.prepare(`SELECT id, name, assigned_truck FROM drivers WHERE assigned_truck IS NOT NULL`).all()
    .forEach(d => { if (!habit.has(String(d.assigned_truck).toUpperCase())) habit.set(String(d.assigned_truck).toUpperCase(), d); });
  const today = todayISO();
  return rows.map(r => {
    const h = habit.get(String(r.truck_code).toUpperCase());
    const status = r.start_date > today ? 'a_venir' : (r.end_date && r.end_date < today ? 'termine' : 'en_cours');
    return {
      ...r,
      reason_label: REASONS[r.reason] || r.reason,
      habitual_driver_id: h ? h.id : null,
      habitual_driver_name: h ? h.name : null,
      status
    };
  });
}

// GET /api/assignments — liste filtrable
assignmentsRouter.get('/', (req, res) => {
  try {
    const { truck, driver_id, status, startDate, endDate } = req.query;
    let sql = `
      SELECT a.*, d.name AS driver_name, d.assigned_truck AS driver_own_truck
      FROM truck_assignments a JOIN drivers d ON d.id = a.driver_id WHERE 1=1`;
    const p = [];
    if (truck) { sql += ' AND UPPER(a.truck_code) = UPPER(?)'; p.push(truck); }
    if (driver_id) { sql += ' AND a.driver_id = ?'; p.push(driver_id); }
    if (startDate) { sql += " AND COALESCE(a.end_date, '9999-12-31') >= ?"; p.push(startDate); }
    if (endDate) { sql += ' AND a.start_date <= ?'; p.push(endDate); }
    sql += ' ORDER BY a.start_date DESC, a.id DESC';
    let rows = withNames(db.prepare(sql).all(...p));
    if (status) rows = rows.filter(r => r.status === status);
    res.json(rows);
  } catch (err) {
    console.error('Erreur get assignments:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des affectations.' });
  }
});

// GET /api/assignments/board?date= — qui conduit quel camion aujourd'hui
assignmentsRouter.get('/board', (req, res) => {
  try {
    const date = isDate(req.query.date) ? req.query.date : todayISO();
    const trucks = db.prepare('SELECT code, brand_model, license_plate, status FROM trucks ORDER BY code').all();
    const board = trucks.map(t => {
      const r = resolveDriver(t.code, date);
      let currentId = r.source === 'echange' ? r.driver_id : (r.habitual ? r.habitual.id : null);
      let currentName = r.source === 'echange' ? r.driver_name : (r.habitual ? r.habitual.name : null);
      // Le chauffeur habituel est parti conduire un AUTRE camion (échange) → ce camion n'a personne
      let habitualElsewhere = null;
      if (r.source !== 'echange' && r.habitual) {
        const away = activeAssignmentForDriver(r.habitual.id, date);
        if (away && String(away.truck_code).toUpperCase() !== String(t.code).toUpperCase()) {
          habitualElsewhere = { truck_code: away.truck_code, reason_label: REASONS[away.reason] || away.reason, start_date: away.start_date, end_date: away.end_date };
          currentId = null;
          currentName = null;
        }
      }
      return {
        truck_code: t.code,
        brand_model: t.brand_model,
        license_plate: t.license_plate,
        truck_status: t.status,
        habitual_driver_id: r.habitual ? r.habitual.id : null,
        habitual_driver_name: r.habitual ? r.habitual.name : null,
        current_driver_id: currentId,
        current_driver_name: currentName,
        is_exchange: r.source === 'echange' && r.is_exchange,
        habitual_elsewhere: habitualElsewhere,
        assignment: r.assignment ? { ...r.assignment, reason_label: REASONS[r.assignment.reason] || r.assignment.reason } : null
      };
    });
    // Chauffeurs sans camion ce jour (habituel remplacé ailleurs, ou aucun camion)
    const driving = new Set(board.map(b => b.current_driver_id).filter(Boolean));
    const idle = db.prepare('SELECT id, name, assigned_truck FROM drivers WHERE is_active = 1 ORDER BY name').all()
      .filter(d => !driving.has(d.id));
    res.json({ date, board, idle_drivers: idle, reasons: REASONS });
  } catch (err) {
    console.error('Erreur board assignments:', err);
    res.status(500).json({ error: 'Erreur lors du calcul du tableau des affectations.' });
  }
});

// GET /api/assignments/resolve?truck=&date=&driver_id= — utilisé par le formulaire voyage
assignmentsRouter.get('/resolve', (req, res) => {
  try {
    const { truck, driver_id } = req.query;
    const date = isDate(req.query.date) ? req.query.date : todayISO();
    if (!truck) return res.status(400).json({ error: 'Camion requis.' });
    const r = resolveDriver(truck, date);
    let driver_elsewhere = null;
    if (driver_id) {
      const a = activeAssignmentForDriver(parseInt(driver_id, 10), date);
      if (a && String(a.truck_code).toUpperCase() !== String(truck).toUpperCase()) driver_elsewhere = a;
    }
    const chosenIsExchange = driver_id && r.habitual ? Number(driver_id) !== r.habitual.id : false;
    res.json({
      date,
      truck: String(truck).toUpperCase(),
      suggested_driver_id: r.source === 'echange' ? r.driver_id : (r.habitual ? r.habitual.id : null),
      suggested_driver_name: r.source === 'echange' ? r.driver_name : (r.habitual ? r.habitual.name : null),
      habitual_driver_id: r.habitual ? r.habitual.id : null,
      habitual_driver_name: r.habitual ? r.habitual.name : null,
      assignment: r.assignment ? { ...r.assignment, reason_label: REASONS[r.assignment.reason] || r.assignment.reason } : null,
      chosen_is_exchange: chosenIsExchange,
      driver_elsewhere
    });
  } catch (err) {
    console.error('Erreur resolve assignment:', err);
    res.status(500).json({ error: 'Erreur de résolution.' });
  }
});

function validate(body, existing = null) {
  const truck_code = (body.truck_code ?? existing?.truck_code ?? '').toString().trim().toUpperCase();
  const driver_id = parseInt(body.driver_id ?? existing?.driver_id, 10);
  const start_date = body.start_date ?? existing?.start_date;
  const end_date = body.end_date === '' ? null : (body.end_date ?? existing?.end_date ?? null);
  const reason = body.reason ?? existing?.reason ?? 'autre';
  if (!truck_code) return { error: 'Camion obligatoire.' };
  if (!db.prepare('SELECT 1 FROM trucks WHERE UPPER(code) = ?').get(truck_code)) return { error: `Camion ${truck_code} introuvable.` };
  if (!driver_id || !db.prepare('SELECT 1 FROM drivers WHERE id = ?').get(driver_id)) return { error: 'Chauffeur introuvable.' };
  if (!isDate(start_date)) return { error: 'Date de début invalide.' };
  if (end_date && !isDate(end_date)) return { error: 'Date de fin invalide.' };
  if (end_date && end_date < start_date) return { error: 'La date de fin doit être après la date de début.' };
  if (!REASONS[reason]) return { error: 'Motif invalide.' };
  return { truck_code, driver_id, start_date, end_date, reason, notes: (body.notes ?? existing?.notes ?? null) || null };
}

// POST /api/assignments — créer un échange
assignmentsRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const v = validate(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const overlap = findOverlap(v.truck_code, v.start_date, v.end_date);
    if (overlap) {
      return res.status(409).json({
        error: `Chevauchement : ${v.truck_code} est déjà confié à ${overlap.driver_name} du ${overlap.start_date}${overlap.end_date ? ' au ' + overlap.end_date : ' (en cours)'}. Terminez cet échange d'abord.`
      });
    }
    const r = db.prepare(`
      INSERT INTO truck_assignments (truck_code, driver_id, start_date, end_date, reason, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(v.truck_code, v.driver_id, v.start_date, v.end_date, v.reason, v.notes, req.user.username);
    const driver = db.prepare('SELECT name FROM drivers WHERE id = ?').get(v.driver_id);
    logAudit({
      username: req.user.username, role: req.user.role, action: 'CREATE', entity: 'assignment', entity_id: r.lastInsertRowid,
      detail: `Échange : ${driver?.name} conduit ${v.truck_code} à partir du ${v.start_date}${v.end_date ? ' jusqu\'au ' + v.end_date : ''} (${REASONS[v.reason]})`,
      ip: req.ip
    });
    const row = db.prepare('SELECT a.*, d.name AS driver_name FROM truck_assignments a JOIN drivers d ON d.id = a.driver_id WHERE a.id = ?').get(r.lastInsertRowid);
    res.status(201).json(withNames([row])[0]);
  } catch (err) {
    console.error('Erreur post assignment:', err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'échange." });
  }
});

// PUT /api/assignments/:id
assignmentsRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM truck_assignments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Échange introuvable.' });
    const v = validate(req.body || {}, existing);
    if (v.error) return res.status(400).json({ error: v.error });
    const overlap = findOverlap(v.truck_code, v.start_date, v.end_date, existing.id);
    if (overlap) return res.status(409).json({ error: `Chevauchement avec l'échange de ${overlap.driver_name} (${overlap.start_date}).` });
    db.prepare(`UPDATE truck_assignments SET truck_code=?, driver_id=?, start_date=?, end_date=?, reason=?, notes=? WHERE id=?`)
      .run(v.truck_code, v.driver_id, v.start_date, v.end_date, v.reason, v.notes, existing.id);
    logAudit({ username: req.user.username, role: req.user.role, action: 'UPDATE', entity: 'assignment', entity_id: existing.id, detail: `Modification échange #${existing.id}`, ip: req.ip });
    const row = db.prepare('SELECT a.*, d.name AS driver_name FROM truck_assignments a JOIN drivers d ON d.id = a.driver_id WHERE a.id = ?').get(existing.id);
    res.json(withNames([row])[0]);
  } catch (err) {
    console.error('Erreur put assignment:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// POST /api/assignments/:id/end — terminer un échange (retour du chauffeur habituel)
assignmentsRouter.post('/:id/end', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM truck_assignments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Échange introuvable.' });
    const end = isDate(req.body?.end_date) ? req.body.end_date : todayISO();
    if (end < existing.start_date) return res.status(400).json({ error: 'La date de fin est avant le début de l\'échange.' });
    db.prepare('UPDATE truck_assignments SET end_date = ? WHERE id = ?').run(end, existing.id);
    logAudit({ username: req.user.username, role: req.user.role, action: 'UPDATE', entity: 'assignment', entity_id: existing.id, detail: `Fin d'échange ${existing.truck_code} le ${end}`, ip: req.ip });
    res.json({ success: true, end_date: end });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la clôture.' });
  }
});

// DELETE /api/assignments/:id
assignmentsRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    db.prepare('DELETE FROM truck_assignments WHERE id = ?').run(req.params.id);
    logAudit({ username: req.user.username, role: req.user.role, action: 'DELETE', entity: 'assignment', entity_id: req.params.id, detail: `Suppression échange #${req.params.id}`, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
