/**
 * Routes API — Journal des modifications (audit_log) accessible à tous les rôles authentifiés.
 * Ne pas exposer l'adresse IP dans cette vue.
 */
import express from 'express';
import { db } from '../db.js';

export const journalRouter = express.Router();

// GET /api/journal — consulter le journal avec filtres (max 500 entrées, IP masquée)
journalRouter.get('/', (req, res) => {
  try {
    const { limit = 50, offset = 0, username, action, entity } = req.query;

    const safeLimit  = Math.min(parseInt(limit,  10) || 50,  500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0,   0);

    let query = `
      SELECT id, username, role, action, entity, entity_id, detail, created_at
      FROM audit_log
      WHERE 1=1
    `;
    const params = [];

    if (username) {
      query += ' AND username LIKE ?';
      params.push(`%${username}%`);
    }
    if (action) {
      query += ' AND action = ?';
      params.push(action.toUpperCase());
    }
    if (entity) {
      query += ' AND entity = ?';
      params.push(entity.toLowerCase());
    }

    // Compter le total (pour pagination)
    const countQuery = `SELECT COUNT(*) as total FROM audit_log WHERE 1=1${
      username ? ' AND username LIKE ?' : ''
    }${action ? ' AND action = ?' : ''}${entity ? ' AND entity = ?' : ''}`;
    const countRow = db.prepare(countQuery).get(...params);

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);

    const rows = db.prepare(query).all(...params);

    res.json({
      total: Number(countRow.total || 0),
      limit:  safeLimit,
      offset: safeOffset,
      rows
    });
  } catch (err) {
    console.error('Erreur get journal:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération du journal.' });
  }
});
