/**
 * Routes API pour les Autres Dépenses (péage, amende, assurance, parking,
 * et tout autre coût lié à un chauffeur ou un camion qui n'est ni
 * carburant ni entretien atelier).
 */
import express from 'express';
import { db } from '../db.js';

export const expensesRouter = express.Router();

// Liste des autres dépenses avec filtres
expensesRouter.get('/', (req, res) => {
  try {
    const { driver_id, truck_id, category, startDate, endDate } = req.query;
    let query = `
      SELECT 
        e.*,
        d.name as driver_name
      FROM other_expenses e
      LEFT JOIN drivers d ON d.id = e.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (driver_id) {
      query += ' AND e.driver_id = ?';
      params.push(driver_id);
    }
    if (truck_id) {
      query += ' AND e.truck_id = ?';
      params.push(truck_id);
    }
    if (category) {
      query += ' AND LOWER(e.category) = LOWER(?)';
      params.push(category);
    }
    if (startDate && endDate) {
      query += ' AND e.expense_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ' AND e.expense_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      query += ' AND e.expense_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY e.expense_date DESC, e.id DESC';

    const records = db.prepare(query).all(...params);
    res.json(records);
  } catch (err) {
    console.error('Erreur get expenses:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des dépenses.' });
  }
});

// Enregistrement d'une dépense
expensesRouter.post('/', (req, res) => {
  try {
    const { driver_id, truck_id, expense_date, category, description, amount_fcfa, notes } = req.body || {};

    if (!expense_date || !category || !description || amount_fcfa === undefined) {
      return res.status(400).json({ error: 'Date, catégorie, description et montant (FCFA) sont obligatoires.' });
    }

    const amount = parseInt(amount_fcfa, 10);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'Montant invalide.' });
    }

    const stmt = db.prepare(`
      INSERT INTO other_expenses (driver_id, truck_id, expense_date, category, description, amount_fcfa, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      driver_id ? parseInt(driver_id, 10) : null,
      truck_id ? truck_id.trim().toUpperCase() : null,
      expense_date,
      category.trim().toLowerCase(),
      description.trim(),
      amount,
      notes ? notes.trim() : null
    );

    const newRecord = db.prepare(`
      SELECT e.*, d.name as driver_name 
      FROM other_expenses e 
      LEFT JOIN drivers d ON d.id = e.driver_id 
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(newRecord);
  } catch (err) {
    console.error('Erreur post expense:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la dépense.' });
  }
});

// Mise à jour d'une dépense
expensesRouter.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM other_expenses WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Dépense introuvable.' });
    }

    const { driver_id, truck_id, expense_date, category, description, amount_fcfa, notes } = req.body || {};

    db.prepare(`
      UPDATE other_expenses 
      SET driver_id = ?, truck_id = ?, expense_date = ?, category = ?, description = ?, amount_fcfa = ?, notes = ?
      WHERE id = ?
    `).run(
      driver_id !== undefined ? (driver_id ? parseInt(driver_id, 10) : null) : existing.driver_id,
      truck_id !== undefined ? (truck_id ? truck_id.trim().toUpperCase() : null) : existing.truck_id,
      expense_date || existing.expense_date,
      category ? category.trim().toLowerCase() : existing.category,
      description ? description.trim() : existing.description,
      amount_fcfa !== undefined ? parseInt(amount_fcfa, 10) : existing.amount_fcfa,
      notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      id
    );

    const updated = db.prepare(`
      SELECT e.*, d.name as driver_name 
      FROM other_expenses e 
      LEFT JOIN drivers d ON d.id = e.driver_id 
      WHERE e.id = ?
    `).get(id);

    res.json(updated);
  } catch (err) {
    console.error('Erreur put expense:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Suppression d'une dépense
expensesRouter.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM other_expenses WHERE id = ?').run(id);
    res.json({ success: true, message: 'Dépense supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
