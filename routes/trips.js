/**
 * Routes API pour les Voyages (Trips)
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';
import { habitualDriver } from '../lib/assignments.js';

/** Chauffeur habituel + drapeau échange pour un voyage */
function exchangeInfo(truckCode, driverId) {
  const h = habitualDriver(truckCode);
  const usual = h ? h.id : null;
  return { usual, isEx: usual !== null && Number(driverId) !== usual ? 1 : 0 };
}

export const tripsRouter = express.Router();

// Liste des voyages avec filtres
tripsRouter.get('/', (req, res) => {
  try {
    const { driver_id, truck_id, startDate, endDate, search } = req.query;
    let query = `
      SELECT 
        t.*,
        d.name as driver_name,
        ud.name as usual_driver_name
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN drivers ud ON ud.id = t.usual_driver_id
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

// Recherche par numéro BL ou conteneur — DOIT être avant /:id
tripsRouter.get('/search/bl-container', (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Paramètre de recherche manquant.' });
    }
    const term = q.trim().toUpperCase();
    const results = db.prepare(`
      SELECT
        t.*,
        d.name as driver_name
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      WHERE UPPER(t.bl_number) LIKE ? OR UPPER(t.container_number) LIKE ?
      ORDER BY t.trip_date DESC
    `).all(`%${term}%`, `%${term}%`);
    res.json(results);
  } catch (err) {
    console.error('Erreur search bl/container:', err);
    res.status(500).json({ error: 'Erreur lors de la recherche.' });
  }
});

// Création d'un voyage
tripsRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { driver_id, truck_id, trip_date, route, recette, dep_carburant, pesee, peage, cargo, bl_number, container_number, client_name, notes } = req.body || {};

    if (!driver_id || !truck_id || !trip_date || !route) {
      return res.status(400).json({ error: 'Chauffeur, camion, date et trajet sont obligatoires.' });
    }

    const recetteVal = recette ? parseInt(recette, 10) : 0;
    const depCarb = dep_carburant ? parseInt(dep_carburant, 10) : 0;
    const peseeVal = pesee ? parseInt(pesee, 10) : 0;
    const peageVal = peage ? parseInt(peage, 10) : 0;
    const montantRemis = depCarb + peseeVal + peageVal;
    // amount_fcfa = montant_remis (kept for backward compat)
    const amount = montantRemis;
    const margeNette = recetteVal - montantRemis;

    const stmt = db.prepare(`
      INSERT INTO trips (driver_id, truck_id, trip_date, route, amount_fcfa, recette, marge_nette, dep_carburant, pesee, peage, montant_remis, cargo, bl_number, container_number, client_name, notes, usual_driver_id, is_exchange, port_row_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ex = exchangeInfo(truck_id, driver_id);

    const result = stmt.run(
      parseInt(driver_id, 10),
      truck_id.trim().toUpperCase(),
      trip_date,
      route.trim(),
      amount,
      recetteVal,
      margeNette,
      depCarb,
      peseeVal,
      peageVal,
      montantRemis,
      cargo ? cargo.trim() : null,
      bl_number ? bl_number.trim().toUpperCase() : null,
      container_number ? container_number.trim().toUpperCase() : null,
      client_name ? client_name.trim() : null,
      notes ? notes.trim() : null,
      ex.usual,
      ex.isEx,
      req.body.port_row_id ? parseInt(req.body.port_row_id, 10) : null
    );

    const newTrip = db.prepare(`
      SELECT t.*, d.name as driver_name, ud.name as usual_driver_name
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN drivers ud ON ud.id = t.usual_driver_id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'trip',
      entity_id: result.lastInsertRowid,
      detail: `Nouveau voyage : ${route} (${trip_date})`,
      ip: req.ip
    });

    res.status(201).json(newTrip);
  } catch (err) {
    console.error('Erreur post trip:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du voyage.' });
  }
});

// Mise à jour d'un voyage
tripsRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Voyage introuvable.' });
    }

    const { driver_id, truck_id, trip_date, route, recette, dep_carburant, pesee, peage, cargo, bl_number, container_number, client_name, notes } = req.body || {};

    const recetteVal = recette !== undefined ? parseInt(recette, 10) : Number(existing.recette || 0);
    const depCarb = dep_carburant !== undefined ? parseInt(dep_carburant, 10) : Number(existing.dep_carburant || 0);
    const peseeVal = pesee !== undefined ? parseInt(pesee, 10) : Number(existing.pesee || 0);
    const peageVal = peage !== undefined ? parseInt(peage, 10) : Number(existing.peage || 0);
    const montantRemis = depCarb + peseeVal + peageVal;
    const margeNette = recetteVal - montantRemis;
    const finalDriver = driver_id ? parseInt(driver_id, 10) : existing.driver_id;
    const finalTruck = truck_id ? truck_id.trim().toUpperCase() : existing.truck_id;
    // Camion inchangé → on conserve le chauffeur habituel historique du voyage
    const exUpd = (finalTruck === existing.truck_id && existing.usual_driver_id)
      ? { usual: existing.usual_driver_id, isEx: Number(finalDriver) !== Number(existing.usual_driver_id) ? 1 : 0 }
      : exchangeInfo(finalTruck, finalDriver);

    db.prepare(`
      UPDATE trips
      SET driver_id = ?, truck_id = ?, trip_date = ?, route = ?, amount_fcfa = ?, recette = ?, marge_nette = ?,
          dep_carburant = ?, pesee = ?, peage = ?, montant_remis = ?,
          cargo = ?, bl_number = ?, container_number = ?, client_name = ?, notes = ?,
          usual_driver_id = ?, is_exchange = ?
      WHERE id = ?
    `).run(
      driver_id ? parseInt(driver_id, 10) : existing.driver_id,
      truck_id ? truck_id.trim().toUpperCase() : existing.truck_id,
      trip_date || existing.trip_date,
      route ? route.trim() : existing.route,
      montantRemis,
      recetteVal,
      margeNette,
      depCarb,
      peseeVal,
      peageVal,
      montantRemis,
      cargo !== undefined ? (cargo ? cargo.trim() : null) : existing.cargo,
      bl_number !== undefined ? (bl_number ? bl_number.trim().toUpperCase() : null) : existing.bl_number,
      container_number !== undefined ? (container_number ? container_number.trim().toUpperCase() : null) : existing.container_number,
      client_name !== undefined ? (client_name ? client_name.trim() : null) : existing.client_name,
      notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      exUpd.usual,
      exUpd.isEx,
      id
    );

    const updated = db.prepare(`
      SELECT t.*, d.name as driver_name, ud.name as usual_driver_name
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN drivers ud ON ud.id = t.usual_driver_id
      WHERE t.id = ?
    `).get(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'trip',
      entity_id: id,
      detail: `Modification voyage #${id}`,
      ip: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Erreur put trip:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Suppression d'un voyage
tripsRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM trips WHERE id = ?').run(id);
    // v4.31 : la ligne de fiche port d'origine redevient "à importer"
    db.prepare(`UPDATE port_exit_rows SET status = 'en_attente', trip_id = NULL WHERE trip_id = ?`).run(id);
    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'trip',
      entity_id: id,
      detail: `Suppression voyage #${id}`,
      ip: req.ip
    });
    res.json({ success: true, message: 'Voyage supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export { exchangeInfo };
