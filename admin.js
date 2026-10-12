/**
 * Routes API réservées au superadmin — Gestion des utilisateurs et journal d'audit
 */
import express from 'express';
import { db } from '../db.js';
import { requireRole, logAudit } from '../auth.js';

export const adminRouter = express.Router();

// Toutes les routes de ce routeur nécessitent le rôle superadmin
adminRouter.use(requireRole('superadmin'));

// ── Utilisateurs ──────────────────────────────────────────────────────────────

// GET /api/admin/users — liste tous les utilisateurs
adminRouter.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      ORDER BY id ASC
    `).all();
    res.json(users);
  } catch (err) {
    console.error('Erreur get users:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
  }
});

// POST /api/admin/users — créer un utilisateur
adminRouter.post('/users', (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Nom d\'utilisateur, mot de passe et rôle sont obligatoires.' });
    }
    const validRoles = ['superadmin', 'editor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide. Valeurs acceptées : superadmin, editor, viewer.' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
    if (existing) {
      return res.status(400).json({ error: `L'utilisateur "${username}" existe déjà.` });
    }

    const result = db.prepare(`
      INSERT INTO users (username, password, role, is_active)
      VALUES (?, ?, ?, 1)
    `).run(username.trim(), password, role);

    const newUser = db.prepare('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'user',
      entity_id: result.lastInsertRowid,
      detail: `Création de l'utilisateur "${username}" avec le rôle "${role}"`,
      ip: req.ip
    });

    res.status(201).json(newUser);
  } catch (err) {
    console.error('Erreur post user:', err);
    res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur.' });
  }
});

// PUT /api/admin/users/:id — modifier un utilisateur
adminRouter.put('/users/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const { username, password, role, is_active } = req.body || {};

    const validRoles = ['superadmin', 'editor', 'viewer'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide.' });
    }

    const updatedUsername = username ? username.trim() : existing.username;
    const updatedPassword = password ? password : existing.password;
    const updatedRole = role || existing.role;
    const updatedActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;

    db.prepare(`
      UPDATE users
      SET username = ?, password = ?, role = ?, is_active = ?
      WHERE id = ?
    `).run(updatedUsername, updatedPassword, updatedRole, updatedActive, id);

    const updated = db.prepare('SELECT id, username, role, is_active, created_at FROM users WHERE id = ?').get(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'user',
      entity_id: id,
      detail: `Modification de l'utilisateur "${updatedUsername}" (rôle: ${updatedRole}, actif: ${updatedActive})`,
      ip: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Erreur put user:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur.' });
  }
});

// DELETE /api/admin/users/:id — supprimer un utilisateur (impossible de se supprimer soi-même)
adminRouter.delete('/users/:id', (req, res) => {
  try {
    const id = req.params.id;

    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'user',
      entity_id: id,
      detail: `Suppression de l'utilisateur "${existing.username}"`,
      ip: req.ip
    });

    res.json({ success: true, message: 'Utilisateur supprimé.' });
  } catch (err) {
    console.error('Erreur delete user:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur.' });
  }
});

// ── Journal d'audit ───────────────────────────────────────────────────────────

// GET /api/admin/audit — consulter le journal d'audit avec filtres
adminRouter.get('/audit', (req, res) => {
  try {
    const { limit = 100, offset = 0, username, action, entity } = req.query;

    let query = `SELECT * FROM audit_log WHERE 1=1`;
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

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10) || 100, parseInt(offset, 10) || 0);

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (err) {
    console.error('Erreur get audit:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération du journal d\'audit.' });
  }
});
