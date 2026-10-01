/**
 * Routes API pour les Voyages (Trips)
 */
import express from 'express';
import { db } from '../db.js';

export const tripsRouter = express.Router();

// Liste des voyages avec filtres
tripsRouter.get('/', (req, res) => {
  try {
    const { driver_id, truck_id, startDate, endDate, search } = req.query;
    let query = `
      SELECT 
        t.*,
        d.name as driver_name
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (driver_id) {
      query += ' AND t.driver_id = ?';
      params.push(driver_id);
    }
    if (truck_id) {
      query += ' AND t.truck_id = ?';
      params.push(truck_id);
    }
    if (startDate && endDate) {
      query += ' AND t.trip_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ' AND t.trip_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      query += ' AND t.trip_date <= ?';
      params.push(endDate);
    }
    if (search && search.trim()) {
      query += ' AND (t.route LIKE ? OR t.cargo LIKE ? OR d.name LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY t.trip_date DESC, t.id DESC';

    const trips = db.prepare(query).all(...params);
    res.json(trips);
  } catch (err) {
    console.error('Erreur get trips:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des voyages.' });
  }
});

// Création d'un voyage
tripsRouter.post('/', (req, res) => {
  try {
    const { driver_id, truck_id, trip_date, route, amount_fcfa, recette, cargo, bl_number, container_number, notes } = req.body || {};

    if (!driver_id || !truck_id || !trip_date || !route || amount_fcfa === undefined) {
      return res.status(400).json({ error: 'Chauffeur, camion, date, trajet et montant (FCFA) sont obligatoires.' });
    }

    const amount = parseInt(amount_fcfa, 10);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'Montant invalide.' });
    }
    const recetteVal = recette ? parseInt(recette, 10) : 0;
    const margeNette = recetteVal - amount;

    const stmt = db.prepare(`
      INSERT INTO trips (driver_id, truck_id, trip_date, route, amount_fcfa, recette, marge_nette, cargo, bl_number, container_number, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      parseInt(driver_id, 10),
      truck_id.trim().toUpperCase(),
      trip_date,
      route.trim(),
      amount,
      recetteVal,
      margeNette,
      cargo ? cargo.trim() : null,
      bl_number ? bl_number.trim().toUpperCase() : null,
      container_number ? container_number.trim().toUpperCase() : null,
      notes ? notes.trim() : null
    );

    const newTrip = db.prepare(`
      SELECT t.*, d.name as driver_name 
      FROM trips t 
      JOIN drivers d ON d.id = t.driver_id 
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(newTrip);
  } catch (err) {
    console.error('Erreur post trip:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du voyage.' });
  }
});

// Mise à jour d'un voyage
tripsRouter.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Voyage introuvable.' });
    }

    const { driver_id, truck_id, trip_date, route, amount_fcfa, cargo, bl_number, container_number, notes } = req.body || {};

    db.prepare(`
      UPDATE trips 
      SET driver_id = ?, truck_id = ?, trip_date = ?, route = ?, amount_fcfa = ?, cargo = ?, bl_number = ?, container_number = ?, notes = ?
      WHERE id = ?
    `).run(
      driver_id ? parseInt(driver_id, 10) : existing.driver_id,
      truck_id ? truck_id.trim().toUpperCase() : existing.truck_id,
      trip_date || existing.trip_date,
      route ? route.trim() : existing.route,
      amount_fcfa !== undefined ? parseInt(amount_fcfa, 10) : existing.amount_fcfa,
      cargo !== undefined ? (cargo ? cargo.trim() : null) : existing.cargo,
      bl_number !== undefined ? (bl_number ? bl_number.trim().toUpperCase() : null) : existing.bl_number,
      container_number !== undefined ? (container_number ? container_number.trim().toUpperCase() : null) : existing.container_number,
      notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      id
    );

    const updated = db.prepare(`
      SELECT t.*, d.name as driver_name 
      FROM trips t 
      JOIN drivers d ON d.id = t.driver_id 
      WHERE t.id = ?
    `).get(id);

    res.json(updated);
  } catch (err) {
    console.error('Erreur put trip:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Suppression d'un voyage
tripsRouter.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM trips WHERE id = ?').run(id);
    res.json({ success: true, message: 'Voyage supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
