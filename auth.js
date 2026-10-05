/**
 * Module d'authentification multi-rôles par cookie de session signé HttpOnly.
 * Rôles : superadmin | editor | viewer
 */
import cookieParser from 'cookie-parser';
import { db } from './db.js';

export const SESSION_SECRET = process.env.SESSION_SECRET || 'changez-ce-secret-en-production';
export const COOKIE_NAME = 'trans_auth_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 heures

export const cookieParserMiddleware = cookieParser(SESSION_SECRET);

function readSession(req) {
  const raw = req.signedCookies && req.signedCookies[COOKIE_NAME];
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/** Middleware : bloque si non authentifié */
export function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Authentification requise.' });
  req.user = { id: session.id, username: session.user, role: session.role };
  next();
}

/** Middleware : bloque si rôle insuffisant */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé : droits insuffisants.' });
    }
    next();
  };
}

/** Enregistre une action dans audit_log */
export function logAudit({ username, role, action, entity, entity_id, detail, ip }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (username, role, action, entity, entity_id, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(username || 'inconnu', role || '', action, entity || null, entity_id ? String(entity_id) : null, detail || null, ip || null);
  } catch (e) {
    console.error('[Audit] Erreur enregistrement:', e.message);
  }
}

export const authController = {
  login(req, res) {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiants manquants.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
    }

    const payload = JSON.stringify({
      id: user.id,
      user: user.username,
      role: user.role,
      exp: Date.now() + SESSION_TTL_MS
    });

    res.cookie(COOKIE_NAME, payload, {
      httpOnly: true,
      signed: true,
      maxAge: SESSION_TTL_MS,
      sameSite: 'lax',
      path: '/',
    });

    logAudit({ username: user.username, role: user.role, action: 'LOGIN', ip: req.ip });
    return res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  },

  logout(req, res) {
    const session = readSession(req);
    if (session) {
      logAudit({ username: session.user, role: session.role, action: 'LOGOUT', ip: req.ip });
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ success: true });
  },

  me(req, res) {
    const session = readSession(req);
    if (!session) return res.status(401).json({ authenticated: false });
    return res.json({
      authenticated: true,
      user: { id: session.id, username: session.user, role: session.role }
    });
  },
};
