/**
 * Routes API pour les Avances et Dettes Chauffeurs
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';

export const advancesRouter = express.Router();

// Liste des avances/remboursements avec filtres
advancesRouter.get('/', (req, res) => {
  try {
    const { driver_id, type, startDate, endDate } = req.query;
    let query = `
      SELECT
        a.*,
        d.name as driver_name
      FROM driver_advances a
      JOIN drivers d ON d.id = a.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (driver_id) {
      query += ' AND a.driver_id = ?';
      params.push(driver_id);
    }
    if (type && (type === 'avance' || type === 'remboursement')) {
      query += ' AND a.type = ?';
      params.push(type);
    }
    if (startDate && endDate) {
      query += ' AND a.advance_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ' AND a.advance_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      query += ' AND a.advance_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY a.advance_date DESC, a.id DESC';

    const records = db.prepare(query).all(...params);
    res.json(records);
  } catch (err) {
    console.error('Erreur get advances:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des avances.' });
  }
});

// Solde net d'un chauffeur (avances - remboursements)
advancesRouter.get('/balance/:driver_id', (req, res) => {
  try {
    const { driver_id } = req.params;

    const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ?').get(driver_id);
    if (!driver) {
      return res.status(404).json({ error: 'Chauffeur introuvable.' });
    }

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'avance' THEN amount_fcfa ELSE 0 END), 0) as total_avances,
        COALESCE(SUM(CASE WHEN type = 'remboursement' THEN amount_fcfa ELSE 0 END), 0) as total_remboursements,
        COUNT(*) as total_operations
      FROM driver_advances
      WHERE driver_id = ?
    `).get(driver_id);

    res.json({
      driver_id: Number(driver_id),
      driver_name: driver.name,
      total_avances: totals.total_avances,
      total_remboursements: totals.total_remboursements,
      solde_net: totals.total_avances - totals.total_remboursements,
      total_operations: totals.total_operations
    });
  } catch (err) {
    console.error('Erreur get advances balance:', err);
    res.status(500).json({ error: 'Erreur lors du calcul du solde.' });
  }
});

// Création d'une avance ou d'un remboursement
advancesRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { driver_id, advance_date, type, amount_fcfa, motif, notes } = req.body || {};

    if (!driver_id || !advance_date || !type || amount_fcfa === undefined || !motif) {
      return res.status(400).json({ error: 'Chauffeur, date, type, montant et motif sont obligatoires.' });
    }
    if (type !== 'avance' && type !== 'remboursement') {
      return res.status(400).json({ error: 'Le type doit être "avance" ou "remboursement".' });
    }

    const amount = parseInt(amount_fcfa, 10);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Le montant doit être un entier positif.' });
    }

    const driver = db.prepare('SELECT name FROM drivers WHERE id = ?').get(driver_id);
    if (!driver) {
      return res.status(404).json({ error: 'Chauffeur introuvable.' });
    }

    const stmt = db.prepare(`
      INSERT INTO driver_advances (driver_id, advance_date, type, amount_fcfa, motif, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      parseInt(driver_id, 10),
      advance_date,
      type,
      amount,
      motif.trim(),
      notes ? notes.trim() : null,
      req.user.username
    );

    const newRecord = db.prepare('SELECT * FROM driver_advances WHERE id = ?').get(result.lastInsertRowid);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'advance',
      entity_id: result.lastInsertRowid,
      detail: `${type === 'avance' ? 'Avance' : 'Remboursement'} de ${amount.toLocaleString('fr-FR')} FCFA pour ${driver.name} — ${motif.trim()}`,
      ip: req.ip
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error('Erreur post advance:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
  }
});

// Modification d'une avance ou d'un remboursement
advancesRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM driver_advances WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Enregistrement introuvable.' });
    }

    const { advance_date, type, amount_fcfa, motif, notes } = req.body || {};

    const updatedDate = advance_date || existing.advance_date;
    const updatedType = (type === 'avance' || type === 'remboursement') ? type : existing.type;
    const updatedAmount = amount_fcfa !== undefined ? parseInt(amount_fcfa, 10) : existing.amount_fcfa;
    const updatedMotif = motif ? motif.trim() : existing.motif;
    const updatedNotes = notes !== undefined ? (notes ? notes.trim() : null) : existing.notes;

    if (isNaN(updatedAmount) || updatedAmount <= 0) {
      return res.status(400).json({ error: 'Le montant doit être un entier positif.' });
    }

    db.prepare(`
      UPDATE driver_advances
      SET advance_date = ?, type = ?, amount_fcfa = ?, motif = ?, notes = ?
      WHERE id = ?
    `).run(updatedDate, updatedType, updatedAmount, updatedMotif, updatedNotes, id);

    const updated = db.prepare('SELECT * FROM driver_advances WHERE id = ?').get(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'advance',
      entity_id: id,
      detail: `Modification ${updatedType} #${id} : ${updatedAmount.toLocaleString('fr-FR')} FCFA — ${updatedMotif}`,
      ip: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Erreur put advance:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Suppression d'une avance ou d'un remboursement
advancesRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM driver_advances WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Enregistrement introuvable.' });
    }

    db.prepare('DELETE FROM driver_advances WHERE id = ?').run(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'advance',
      entity_id: id,
      detail: `Suppression ${existing.type} #${id} : ${existing.amount_fcfa.toLocaleString('fr-FR')} FCFA — ${existing.motif}`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Enregistrement supprimé avec succès.' });
  } catch (err) {
    console.error('Erreur delete advance:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
