/**
 * Routes API pour les sous-traitants (transporteurs externes).
 * Couvre la gestion des sous-traitants et de leurs voyages.
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';

export const subcontractorsRouter = express.Router();

// ─────────────────────────────────────────────────────────────
// SOUS-TRAITANTS
// ─────────────────────────────────────────────────────────────

// Liste tous les sous-traitants
subcontractorsRouter.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.*,
        COUNT(t.id) as trips_count,
        COALESCE(SUM(t.client_revenue), 0) as total_revenue,
        COALESCE(SUM(t.subcontractor_cost), 0) as total_cost,
        COALESCE(SUM(t.client_revenue - t.subcontractor_cost), 0) as total_margin
      FROM subcontractors s
      LEFT JOIN subcontractor_trips t ON t.subcontractor_id = s.id
      GROUP BY s.id
      ORDER BY s.name ASC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('Erreur get subcontractors:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des sous-traitants.' });
  }
});

// Créer un sous-traitant
subcontractorsRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { name, contact, phone, email, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Le nom est requis.' });
    const result = db.prepare(`
      INSERT INTO subcontractors (name, contact, phone, email, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, contact || null, phone || null, email || null, notes || null);
    const created = db.prepare('SELECT * FROM subcontractors WHERE id = ?').get(result.lastInsertRowid);
    logAudit(req, 'CREATE', 'subcontractor', result.lastInsertRowid, `Nouveau sous-traitant : ${name}`);
    res.status(201).json(created);
  } catch (err) {
    console.error('Erreur post subcontractor:', err);
    res.status(500).json({ error: 'Erreur lors de la création du sous-traitant.' });
  }
});

// Modifier un sous-traitant
subcontractorsRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM subcontractors WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Sous-traitant introuvable.' });
    const { name, contact, phone, email, notes, is_active } = req.body || {};
    db.prepare(`
      UPDATE subcontractors SET name=?, contact=?, phone=?, email=?, notes=?, is_active=? WHERE id=?
    `).run(
      name || existing.name,
      contact ?? existing.contact,
      phone ?? existing.phone,
      email ?? existing.email,
      notes ?? existing.notes,
      is_active ?? existing.is_active,
      id
    );
    const updated = db.prepare('SELECT * FROM subcontractors WHERE id = ?').get(id);
    logAudit(req, 'UPDATE', 'subcontractor', id, `Modification : ${updated.name}`);
    res.json(updated);
  } catch (err) {
    console.error('Erreur put subcontractor:', err);
    res.status(500).json({ error: 'Erreur lors de la modification.' });
  }
});

// Supprimer un sous-traitant
subcontractorsRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT name FROM subcontractors WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Sous-traitant introuvable.' });
    db.prepare('DELETE FROM subcontractors WHERE id = ?').run(id);
    logAudit(req, 'DELETE', 'subcontractor', id, `Suppression : ${existing.name}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur delete subcontractor:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ─────────────────────────────────────────────────────────────
// VOYAGES SOUS-TRAITÉS
// ─────────────────────────────────────────────────────────────

// Liste des voyages (tous ou filtrés par sous-traitant / dates)
subcontractorsRouter.get('/trips', (req, res) => {
  try {
    const { subcontractor_id, startDate, endDate } = req.query;
    let query = `
      SELECT t.*, s.name as subcontractor_name
      FROM subcontractor_trips t
      JOIN subcontractors s ON s.id = t.subcontractor_id
      WHERE 1=1
    `;
    const params = [];
    if (subcontractor_id) { query += ' AND t.subcontractor_id = ?'; params.push(subcontractor_id); }
    if (startDate && endDate) { query += ' AND t.trip_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
    else if (startDate) { query += ' AND t.trip_date >= ?'; params.push(startDate); }
    else if (endDate) { query += ' AND t.trip_date <= ?'; params.push(endDate); }
    query += ' ORDER BY t.trip_date DESC, t.id DESC';
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (err) {
    console.error('Erreur get subcontractor trips:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des voyages.' });
  }
});

// Créer un voyage sous-traité
subcontractorsRouter.post('/trips', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { subcontractor_id, trip_date, destination, goods, bl_number, container_number, client_revenue, subcontractor_cost, notes } = req.body || {};
    if (!subcontractor_id || !trip_date || !destination) {
      return res.status(400).json({ error: 'sous-traitant, date et destination sont requis.' });
    }
    const result = db.prepare(`
      INSERT INTO subcontractor_trips (subcontractor_id, trip_date, destination, goods, bl_number, container_number, client_revenue, subcontractor_cost, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subcontractor_id, trip_date, destination,
      goods || null, bl_number || null, container_number || null,
      client_revenue || 0, subcontractor_cost || 0,
      notes || null, req.session?.username || null
    );
    const created = db.prepare(`
      SELECT t.*, s.name as subcontractor_name FROM subcontractor_trips t
      JOIN subcontractors s ON s.id = t.subcontractor_id WHERE t.id = ?
    `).get(result.lastInsertRowid);
    logAudit(req, 'CREATE', 'subcontractor_trip', result.lastInsertRowid, `Voyage sous-traité : ${destination}`);
    res.status(201).json(created);
  } catch (err) {
    console.error('Erreur post subcontractor trip:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du voyage.' });
  }
});

// Modifier un voyage
subcontractorsRouter.put('/trips/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM subcontractor_trips WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Voyage introuvable.' });
    const { subcontractor_id, trip_date, destination, goods, bl_number, container_number, client_revenue, subcontractor_cost, notes } = req.body || {};
    db.prepare(`
      UPDATE subcontractor_trips SET subcontractor_id=?, trip_date=?, destination=?, goods=?, bl_number=?, container_number=?, client_revenue=?, subcontractor_cost=?, notes=? WHERE id=?
    `).run(
      subcontractor_id ?? existing.subcontractor_id,
      trip_date || existing.trip_date,
      destination || existing.destination,
      goods ?? existing.goods,
      bl_number ?? existing.bl_number,
      container_number ?? existing.container_number,
      client_revenue ?? existing.client_revenue,
      subcontractor_cost ?? existing.subcontractor_cost,
      notes ?? existing.notes,
      id
    );
    const updated = db.prepare(`
      SELECT t.*, s.name as subcontractor_name FROM subcontractor_trips t
      JOIN subcontractors s ON s.id = t.subcontractor_id WHERE t.id = ?
    `).get(id);
    logAudit(req, 'UPDATE', 'subcontractor_trip', id, `Modification voyage : ${updated.destination}`);
    res.json(updated);
  } catch (err) {
    console.error('Erreur put subcontractor trip:', err);
    res.status(500).json({ error: 'Erreur lors de la modification.' });
  }
});

// Supprimer un voyage
subcontractorsRouter.delete('/trips/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM subcontractor_trips WHERE id = ?').run(id);
    logAudit(req, 'DELETE', 'subcontractor_trip', id, 'Suppression voyage sous-traité');
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur delete subcontractor trip:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ─────────────────────────────────────────────────────────────
// TABLEAU DE BORD SOUS-TRAITANCE
// ─────────────────────────────────────────────────────────────
subcontractorsRouter.get('/dashboard', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = '';
    const params = [];
    if (startDate && endDate) { dateFilter = 'AND t.trip_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
    else if (startDate) { dateFilter = 'AND t.trip_date >= ?'; params.push(startDate); }
    else if (endDate) { dateFilter = 'AND t.trip_date <= ?'; params.push(endDate); }

    // Global summary
    const summary = db.prepare(`
      SELECT
        COUNT(t.id) as trips_count,
        COALESCE(SUM(t.client_revenue), 0) as total_revenue,
        COALESCE(SUM(t.subcontractor_cost), 0) as total_cost,
        COALESCE(SUM(t.client_revenue - t.subcontractor_cost), 0) as total_margin,
        COUNT(DISTINCT t.subcontractor_id) as subcontractors_used
      FROM subcontractor_trips t
      WHERE 1=1 ${dateFilter}
    `).get(...params);

    // Per-subcontractor breakdown
    const bySubcontractor = db.prepare(`
      SELECT s.id, s.name,
        COUNT(t.id) as trips_count,
        COALESCE(SUM(t.client_revenue), 0) as total_revenue,
        COALESCE(SUM(t.subcontractor_cost), 0) as total_cost,
        COALESCE(SUM(t.client_revenue - t.subcontractor_cost), 0) as total_margin,
        CASE WHEN SUM(t.client_revenue) > 0
          THEN ROUND(SUM(t.client_revenue - t.subcontractor_cost) * 100.0 / SUM(t.client_revenue), 1)
          ELSE 0 END as margin_pct
      FROM subcontractors s
      LEFT JOIN subcontractor_trips t ON t.subcontractor_id = s.id AND 1=1 ${dateFilter}
      GROUP BY s.id
      ORDER BY total_revenue DESC
    `).all(...params);

    // Monthly timeline for chart
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', t.trip_date) as month,
        COUNT(*) as trips,
        SUM(t.client_revenue) as revenue,
        SUM(t.subcontractor_cost) as cost,
        SUM(t.client_revenue - t.subcontractor_cost) as margin
      FROM subcontractor_trips t
      WHERE 1=1 ${dateFilter}
      GROUP BY month ORDER BY month ASC
    `).all(...params);

    // YM-TRANSIT own fleet stats for comparison (same period)
    const ymFleet = db.prepare(`
      SELECT
        COUNT(t.id) as trips_count,
        COALESCE(SUM(t.recette), 0) as total_revenue,
        COALESCE(SUM(t.dep_carburant) + SUM(t.pesee) + SUM(t.peage), 0) as total_trip_costs,
        COALESCE(SUM(t.marge_nette), 0) as total_margin
      FROM trips t
      WHERE 1=1 ${dateFilter.replace(/t\.trip_date/g, 't.trip_date')}
    `).get(...params);

    const ymMaint = db.prepare(`
      SELECT COALESCE(SUM(amount_fcfa), 0) as total
      FROM maintenance_records
      WHERE 1=1 ${dateFilter.replace(/t\.trip_date/g, 'record_date')}
    `).get(...params);

    const ymFuel = db.prepare(`
      SELECT COALESCE(SUM(amount_fcfa), 0) as total
      FROM fuel_expenses
      WHERE 1=1 ${dateFilter.replace(/t\.trip_date/g, 'expense_date')}
    `).get(...params);

    res.json({
      summary,
      bySubcontractor,
      monthly,
      comparison: {
        ymTransit: {
          trips_count: ymFleet.trips_count,
          total_revenue: ymFleet.total_revenue,
          total_cost: (ymFleet.total_trip_costs || 0) + (ymMaint.total || 0) + (ymFuel.total || 0),
          total_margin: ymFleet.total_margin,
          margin_pct: ymFleet.total_revenue > 0
            ? Math.round(ymFleet.total_margin * 100 / ymFleet.total_revenue * 10) / 10
            : 0
        },
        subcontractors: {
          trips_count: summary.trips_count,
          total_revenue: summary.total_revenue,
          total_cost: summary.total_cost,
          total_margin: summary.total_margin,
          margin_pct: summary.total_revenue > 0
            ? Math.round(summary.total_margin * 100 / summary.total_revenue * 10) / 10
            : 0
        }
      }
    });
  } catch (err) {
    console.error('Erreur dashboard sous-traitants:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du tableau de bord.' });
  }
});
