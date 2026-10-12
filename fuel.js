/**
 * Routes API pour les Dépenses de Carburant (Fuel)
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';

export const fuelRouter = express.Router();

// Liste des dépenses de carburant avec filtres
fuelRouter.get('/', (req, res) => {
  try {
    const { driver_id, truck_id, startDate, endDate } = req.query;
    let query = `
      SELECT 
        f.*,
        d.name as driver_name
      FROM fuel_expenses f
      JOIN drivers d ON d.id = f.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (driver_id) {
      query += ' AND f.driver_id = ?';
      params.push(driver_id);
    }
    if (truck_id) {
      query += ' AND f.truck_id = ?';
      params.push(truck_id);
    }
    if (startDate && endDate) {
      query += ' AND f.expense_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ' AND f.expense_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      query += ' AND f.expense_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY f.expense_date DESC, f.id DESC';

    const records = db.prepare(query).all(...params);
    res.json(records);
  } catch (err) {
    console.error('Erreur get fuel:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération du carburant.' });
  }
});

// Enregistrement d'un plein de carburant
fuelRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { driver_id, truck_id, expense_date, liters, amount_fcfa, station, km_at_fill, notes } = req.body || {};

    if (!driver_id || !truck_id || !expense_date || !liters || amount_fcfa === undefined || !station) {
      return res.status(400).json({ error: 'Chauffeur, camion, date, litres, montant (FCFA) et station sont obligatoires.' });
    }

    const numLiters = parseFloat(liters);
    const amount = parseInt(amount_fcfa, 10);
    const km = km_at_fill ? parseInt(km_at_fill, 10) : null;

    if (isNaN(numLiters) || isNaN(amount)) {
      return res.status(400).json({ error: 'Valeurs numériques invalides pour litres ou montant.' });
    }

    const stmt = db.prepare(`
      INSERT INTO fuel_expenses (driver_id, truck_id, expense_date, liters, amount_fcfa, station, km_at_fill, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      parseInt(driver_id, 10),
      truck_id.trim().toUpperCase(),
      expense_date,
      numLiters,
      amount,
      station.trim(),
      km,
      notes ? notes.trim() : null
    );

    // Mettre à jour le kilométrage actuel du camion si supérieur
    if (km) {
      db.prepare(`
        UPDATE trucks 
        SET current_km = MAX(COALESCE(current_km, 0), ?) 
        WHERE code = ?
      `).run(km, truck_id.trim().toUpperCase());
    }

    const newRecord = db.prepare(`
      SELECT f.*, d.name as driver_name
      FROM fuel_expenses f
      JOIN drivers d ON d.id = f.driver_id
      WHERE f.id = ?
    `).get(result.lastInsertRowid);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'fuel',
      entity_id: result.lastInsertRowid,
      detail: `Plein carburant : ${numLiters}L — ${amount} FCFA (${station})`,
      ip: req.ip
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error('Erreur post fuel:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du carburant.' });
  }
});

// Mise à jour d'un plein
fuelRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM fuel_expenses WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Enregistrement de carburant introuvable.' });
    }

    const { driver_id, truck_id, expense_date, liters, amount_fcfa, station, km_at_fill, notes } = req.body || {};

    const updatedTruck = truck_id ? truck_id.trim().toUpperCase() : existing.truck_id;
    const updatedKm = km_at_fill !== undefined ? (km_at_fill ? parseInt(km_at_fill, 10) : null) : existing.km_at_fill;

    db.prepare(`
      UPDATE fuel_expenses 
      SET driver_id = ?, truck_id = ?, expense_date = ?, liters = ?, amount_fcfa = ?, station = ?, km_at_fill = ?, notes = ?
      WHERE id = ?
    `).run(
      driver_id ? parseInt(driver_id, 10) : existing.driver_id,
      updatedTruck,
      expense_date || existing.expense_date,
      liters !== undefined ? parseFloat(liters) : existing.liters,
      amount_fcfa !== undefined ? parseInt(amount_fcfa, 10) : existing.amount_fcfa,
      station ? station.trim() : existing.station,
      updatedKm,
      notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      id
    );

    if (updatedKm) {
      db.prepare(`
        UPDATE trucks 
        SET current_km = MAX(COALESCE(current_km, 0), ?) 
        WHERE code = ?
      `).run(updatedKm, updatedTruck);
    }

    const updated = db.prepare(`
      SELECT f.*, d.name as driver_name
      FROM fuel_expenses f
      JOIN drivers d ON d.id = f.driver_id
      WHERE f.id = ?
    `).get(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'fuel',
      entity_id: id,
      detail: `Modification carburant #${id}`,
      ip: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Erreur put fuel:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Suppression d'un plein
fuelRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM fuel_expenses WHERE id = ?').run(id);
    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'fuel',
      entity_id: id,
      detail: `Suppression carburant #${id}`,
      ip: req.ip
    });
    res.json({ success: true, message: 'Enregistrement supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
