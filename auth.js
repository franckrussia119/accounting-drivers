/**
 * Module d'authentification par cookie de session signé HttpOnly.
 * Le cookie est signé par cookie-parser (HMAC via SESSION_SECRET) : toute
 * altération du cookie par le client est détectée et rejetée.
 */
import cookieParser from 'cookie-parser';

export const SESSION_SECRET = process.env.SESSION_SECRET || 'changez-ce-secret-en-production';
export const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
export const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'changeme123';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 heures
export const COOKIE_NAME = 'trans_auth_session';

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

/**
 * Middleware d'authentification : bloque toute route protégée si la
 * session est absente, invalide ou expirée.
 */
export function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  req.user = { username: session.user };
  next();
}

export const authController = {
  login(req, res) {
    const { username, password } = req.body || {};
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username !== AUTH_USERNAME ||
      password !== AUTH_PASSWORD
    ) {
      return res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
    }

    const payload = JSON.stringify({ user: username, exp: Date.now() + SESSION_TTL_MS });
    res.cookie(COOKIE_NAME, payload, {
      httpOnly: true,
      signed: true,
      maxAge: SESSION_TTL_MS,
      sameSite: 'lax',
      path: '/',
    });
    return res.json({ success: true, user: { username } });
  },

  logout(req, res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ success: true });
  },

  me(req, res) {
    const session = readSession(req);
    if (!session) {
      return res.status(401).json({ authenticated: false });
    }
    return res.json({ authenticated: true, user: { username: session.user } });
  },
};
