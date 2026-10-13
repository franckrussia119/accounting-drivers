/**
 * Routes API pour la Gestion des Documents Administratifs (fleet_documents)
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';

export const documentsRouter = express.Router();

// ── GET / — Liste des documents avec filtres ────────────────────────────────
documentsRouter.get('/', (req, res) => {
  try {
    const { entity_type, entity_id, status, doc_type } = req.query;

    let query = `
      SELECT fd.*,
        CASE fd.entity_type
          WHEN 'truck' THEN fd.entity_id
          ELSE NULL
        END as truck_code,
        d.name as driver_name
      FROM fleet_documents fd
      LEFT JOIN drivers d ON d.id = fd.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (entity_type) {
      query += ' AND fd.entity_type = ?';
      params.push(entity_type);
    }
    if (entity_id) {
      query += ' AND fd.entity_id = ?';
      params.push(entity_id);
    }
    if (doc_type) {
      query += ' AND fd.doc_type = ?';
      params.push(doc_type);
    }

    query += ' ORDER BY fd.expiry_date ASC, fd.id DESC';

    let docs = db.prepare(query).all(...params);

    // Filtre par statut calculé côté serveur (basé sur expiry_date)
    if (status) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in30 = new Date(today);
      in30.setDate(in30.getDate() + 30);

      docs = docs.filter(d => {
        if (!d.expiry_date) return status === 'valid';
        const exp = new Date(d.expiry_date);
        if (exp < today) return status === 'expired';
        if (exp <= in30) return status === 'expiring';
        return status === 'valid';
      });
    }

    res.json(docs);
  } catch (err) {
    console.error('Erreur get documents:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des documents.' });
  }
});

// ── GET /alerts — Nombre de docs expirés + expirant dans 30j ───────────────
documentsRouter.get('/alerts', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const in30str = in30.toISOString().slice(0, 10);

    const expired = db.prepare(
      `SELECT COUNT(*) as c FROM fleet_documents WHERE expiry_date IS NOT NULL AND expiry_date < ?`
    ).get(today);

    const expiring = db.prepare(
      `SELECT COUNT(*) as c FROM fleet_documents WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ?`
    ).get(today, in30str);

    res.json({
      expired: expired.c,
      expiring: expiring.c,
      total: expired.c + expiring.c
    });
  } catch (err) {
    console.error('Erreur get alerts:', err);
    res.status(500).json({ error: 'Erreur.' });
  }
});

// ── GET /accounting — Résumé comptable des dépenses de documents ─────────────
documentsRouter.get('/accounting', (req, res) => {
  try {
    const { year } = req.query;
    let whereClause = '';
    const params = [];
    if (year) {
      whereClause = `WHERE strftime('%Y', issue_date) = ?`;
      params.push(year);
    }

    const summary = db.prepare(`
      SELECT
        SUM(COALESCE(amount_fcfa, 0)) as total_spent,
        SUM(COALESCE(renewal_cost, 0)) as total_renewal_forecast,
        COUNT(*) as total_docs,
        COUNT(CASE WHEN entity_type = 'truck' THEN 1 END) as truck_docs,
        COUNT(CASE WHEN entity_type = 'driver' THEN 1 END) as driver_docs
      FROM fleet_documents ${whereClause}
    `).get(...params);

    const byType = db.prepare(`
      SELECT doc_type, COUNT(*) as count, SUM(COALESCE(amount_fcfa, 0)) as total
      FROM fleet_documents ${whereClause}
      GROUP BY doc_type
      ORDER BY total DESC
    `).all(...params);

    const byTruck = db.prepare(`
      SELECT entity_id as truck_code, COUNT(*) as count, SUM(COALESCE(amount_fcfa, 0)) as total
      FROM fleet_documents
      WHERE entity_type = 'truck' ${year ? "AND strftime('%Y', issue_date) = ?" : ''}
      GROUP BY entity_id
      ORDER BY total DESC
    `).all(...(year ? [year] : []));

    res.json({ summary, byType, byTruck });
  } catch (err) {
    console.error('Erreur accounting documents:', err);
    res.status(500).json({ error: 'Erreur lors du calcul comptable.' });
  }
});

// ── GET /:id ────────────────────────────────────────────────────────────────
documentsRouter.get('/:id', (req, res) => {
  try {
    const doc = db.prepare('SELECT * FROM fleet_documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── POST / ──────────────────────────────────────────────────────────────────
documentsRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const {
      entity_type, entity_id, doc_type, doc_name,
      file_url, issue_date, expiry_date, notes,
      amount_fcfa, renewal_cost, driver_id
    } = req.body || {};

    if (!entity_type || !entity_id || !doc_type || !doc_name) {
      return res.status(400).json({ error: 'Entité, ID entité, type de document et nom sont obligatoires.' });
    }
    if (!['truck', 'driver'].includes(entity_type)) {
      return res.status(400).json({ error: 'entity_type doit être "truck" ou "driver".' });
    }

    const result = db.prepare(`
      INSERT INTO fleet_documents
        (entity_type, entity_id, doc_type, doc_name, file_url,
         issue_date, expiry_date, notes, created_by,
         amount_fcfa, renewal_cost, driver_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity_type,
      entity_id.toString(),
      doc_type.trim(),
      doc_name.trim(),
      file_url || null,
      issue_date || null,
      expiry_date || null,
      notes ? notes.trim() : null,
      req.user.username,
      amount_fcfa ? parseInt(amount_fcfa, 10) : 0,
      renewal_cost ? parseInt(renewal_cost, 10) : 0,
      driver_id ? parseInt(driver_id, 10) : null
    );

    const newDoc = db.prepare('SELECT * FROM fleet_documents WHERE id = ?').get(result.lastInsertRowid);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'document',
      entity_id: result.lastInsertRowid,
      detail: `Nouveau document : ${doc_name} (${doc_type}) pour ${entity_type} #${entity_id}`,
      ip: req.ip
    });

    res.status(201).json(newDoc);
  } catch (err) {
    console.error('Erreur post document:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du document.' });
  }
});

// ── PUT /:id ─────────────────────────────────────────────────────────────────
documentsRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM fleet_documents WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Document introuvable.' });

    const {
      entity_type, entity_id, doc_type, doc_name,
      file_url, issue_date, expiry_date, notes,
      amount_fcfa, renewal_cost, driver_id
    } = req.body || {};

    if (entity_type && !['truck', 'driver'].includes(entity_type)) {
      return res.status(400).json({ error: 'entity_type doit être "truck" ou "driver".' });
    }

    db.prepare(`
      UPDATE fleet_documents
      SET entity_type = ?, entity_id = ?, doc_type = ?, doc_name = ?,
          file_url = ?, issue_date = ?, expiry_date = ?, notes = ?,
          amount_fcfa = ?, renewal_cost = ?, driver_id = ?
      WHERE id = ?
    `).run(
      entity_type || existing.entity_type,
      entity_id ? entity_id.toString() : existing.entity_id,
      doc_type ? doc_type.trim() : existing.doc_type,
      doc_name ? doc_name.trim() : existing.doc_name,
      file_url !== undefined ? (file_url || null) : existing.file_url,
      issue_date !== undefined ? (issue_date || null) : existing.issue_date,
      expiry_date !== undefined ? (expiry_date || null) : existing.expiry_date,
      notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      amount_fcfa !== undefined ? (amount_fcfa ? parseInt(amount_fcfa, 10) : 0) : (existing.amount_fcfa || 0),
      renewal_cost !== undefined ? (renewal_cost ? parseInt(renewal_cost, 10) : 0) : (existing.renewal_cost || 0),
      driver_id !== undefined ? (driver_id ? parseInt(driver_id, 10) : null) : existing.driver_id,
      id
    );

    const updated = db.prepare('SELECT * FROM fleet_documents WHERE id = ?').get(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'document',
      entity_id: id,
      detail: `Modification document #${id} — ${updated.doc_name}`,
      ip: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Erreur put document:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// ── DELETE /:id ──────────────────────────────────────────────────────────────
documentsRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    const doc = db.prepare('SELECT * FROM fleet_documents WHERE id = ?').get(id);
    if (!doc) return res.status(404).json({ error: 'Document introuvable.' });

    db.prepare('DELETE FROM fleet_documents WHERE id = ?').run(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'document',
      entity_id: id,
      detail: `Suppression document #${id} — ${doc.doc_name} (${doc.doc_type})`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Document supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});
