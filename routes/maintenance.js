/**
 * Routes API pour l'Entretien et les Réparations (Maintenance)
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';

export const maintenanceRouter = express.Router();

// Liste des interventions d'entretien avec filtres
maintenanceRouter.get('/', (req, res) => {
  try {
    const { truck_id, driver_id, service_type, startDate, endDate } = req.query;
    let query = `
      SELECT 
        m.*,
        d.name as driver_name
      FROM maintenance_records m
      LEFT JOIN drivers d ON d.id = m.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (truck_id) {
      query += ' AND m.truck_id = ?';
      params.push(truck_id);
    }
    if (driver_id) {
      query += ' AND m.driver_id = ?';
      params.push(driver_id);
    }
    if (service_type) {
      query += ' AND LOWER(m.service_type) = LOWER(?)';
      params.push(service_type);
    }
    if (startDate && endDate) {
      query += ' AND m.record_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ' AND m.record_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      query += ' AND m.record_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY m.record_date DESC, m.id DESC';

    const records = db.prepare(query).all(...params);
    res.json(records);
  } catch (err) {
    console.error('Erreur get maintenance:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des entretiens.' });
  }
});

// Enregistrement d'une intervention
maintenanceRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { truck_id, driver_id, record_date, service_type, description, amount_fcfa, garage, km, line_items } = req.body || {};

    if (!truck_id || !record_date || !service_type || !description || amount_fcfa === undefined || !garage) {
      return res.status(400).json({ error: 'Camion, date, type d\'intervention, description, montant (FCFA) et garage sont obligatoires.' });
    }

    const amount = parseInt(amount_fcfa, 10);
    const numKm = km ? parseInt(km, 10) : null;

    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'Montant invalide.' });
    }

    const stmt = db.prepare(`
      INSERT INTO maintenance_records (truck_id, driver_id, record_date, service_type, description, amount_fcfa, garage, km, line_items)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      truck_id.trim().toUpperCase(),
      driver_id ? parseInt(driver_id, 10) : null,
      record_date,
      service_type.trim().toLowerCase(),
      description.trim(),
      amount,
      garage.trim(),
      numKm,
      line_items || null
    );

    // Mettre à jour le kilométrage du camion si renseigné
    if (numKm) {
      db.prepare(`
        UPDATE trucks 
        SET current_km = MAX(COALESCE(current_km, 0), ?) 
        WHERE code = ?
      `).run(numKm, truck_id.trim().toUpperCase());
    }

    const newRecord = db.prepare(`
      SELECT m.*, d.name as driver_name
      FROM maintenance_records m
      LEFT JOIN drivers d ON d.id = m.driver_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'maintenance',
      entity_id: result.lastInsertRowid,
      detail: `Nouvelle intervention : ${service_type} — ${description} (${amount} FCFA, ${garage})`,
      ip: req.ip
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error('Erreur post maintenance:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de l\'entretien.' });
  }
});

// Mise à jour d'une intervention
maintenanceRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM maintenance_records WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Intervention introuvable.' });
    }

    const { truck_id, driver_id, record_date, service_type, description, amount_fcfa, garage, km, line_items } = req.body || {};

    const updatedTruck = truck_id ? truck_id.trim().toUpperCase() : existing.truck_id;
    const updatedKm = km !== undefined ? (km ? parseInt(km, 10) : null) : existing.km;

    db.prepare(`
      UPDATE maintenance_records
      SET truck_id = ?, driver_id = ?, record_date = ?, service_type = ?, description = ?, amount_fcfa = ?, garage = ?, km = ?, line_items = ?
      WHERE id = ?
    `).run(
      updatedTruck,
      driver_id !== undefined ? (driver_id ? parseInt(driver_id, 10) : null) : existing.driver_id,
      record_date || existing.record_date,
      service_type ? service_type.trim().toLowerCase() : existing.service_type,
      description ? description.trim() : existing.description,
      amount_fcfa !== undefined ? parseInt(amount_fcfa, 10) : existing.amount_fcfa,
      garage ? garage.trim() : existing.garage,
      updatedKm,
      line_items !== undefined ? (line_items || null) : existing.line_items,
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
      SELECT m.*, d.name as driver_name
      FROM maintenance_records m
      LEFT JOIN drivers d ON d.id = m.driver_id
      WHERE m.id = ?
    `).get(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'maintenance',
      entity_id: id,
      detail: `Modification entretien #${id}`,
      ip: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Erreur put maintenance:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Suppression d'une intervention
maintenanceRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM maintenance_records WHERE id = ?').run(id);
    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'maintenance',
      entity_id: id,
      detail: `Suppression entretien #${id}`,
      ip: req.ip
    });
    res.json({ success: true, message: 'Intervention supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
