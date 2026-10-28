/**
 * v4.32 — Notifications Web Push (téléphone de l'agent + ordinateurs du bureau).
 * Les clés VAPID sont générées au premier démarrage et gardées dans app_settings.
 * Aucune dépendance à un service payant : Chrome / Safari livrent les notifications.
 */
import webpush from 'web-push';
import { db, getSetting, setSetting } from '../db.js';

let ready = false;

export function vapidPublicKey() {
  init();
  return getSetting('vapid_public_key');
}

function init() {
  if (ready) return;
  let pub = process.env.VAPID_PUBLIC_KEY || getSetting('vapid_public_key');
  let priv = process.env.VAPID_PRIVATE_KEY || getSetting('vapid_private_key');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    setSetting('vapid_public_key', pub, 'system');
    setSetting('vapid_private_key', priv, 'system');
    console.log('[Notifications] Clés VAPID générées.');
  } else if (!getSetting('vapid_public_key')) {
    setSetting('vapid_public_key', pub, 'system');
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@ym-transit.cm', pub, priv);
  ready = true;
}

export function saveSubscription(user, sub, userAgent) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Abonnement invalide.');
  db.prepare(`
    INSERT INTO push_subscriptions (username, role, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET username = excluded.username, role = excluded.role,
      p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
  `).run(user.username, user.role, sub.endpoint, sub.keys.p256dh, sub.keys.auth, (userAgent || '').slice(0, 200));
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function hasSubscription(username) {
  return !!db.prepare('SELECT 1 FROM push_subscriptions WHERE username = ?').get(username);
}

async function sendTo(rows, payload) {
  if (!rows.length) return { sent: 0 };
  init();
  const body = JSON.stringify({
    title: payload.title || 'YM-TRANSIT',
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || undefined,
    ts: Date.now()
  });
  let sent = 0;
  await Promise.all(rows.map(async r => {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, { TTL: 24 * 3600, urgency: payload.urgency || 'normal' });
      db.prepare('UPDATE push_subscriptions SET last_ok_at = CURRENT_TIMESTAMP WHERE id = ?').run(r.id);
      sent++;
    } catch (e) {
      // 404 / 410 : abonnement expiré (appli désinstallée, notifications coupées) → on nettoie
      if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(r.endpoint);
      else console.error('[Notifications] Envoi échoué:', e.statusCode || '', e.body || e.message);
    }
  }));
  return { sent };
}

/** Notifier un utilisateur (toutes ses installations) — ne bloque jamais l'appelant */
export function notifyUser(username, payload) {
  try {
    const rows = db.prepare('SELECT * FROM push_subscriptions WHERE username = ?').all(username);
    return sendTo(rows, payload).catch(() => ({ sent: 0 }));
  } catch (e) { return Promise.resolve({ sent: 0 }); }
}

/** Notifier tous les utilisateurs d'un ou plusieurs rôles */
export function notifyRoles(roles, payload) {
  try {
    const rows = db.prepare(`SELECT * FROM push_subscriptions WHERE role IN (${roles.map(() => '?').join(',')})`).all(...roles);
    return sendTo(rows, payload).catch(() => ({ sent: 0 }));
  } catch (e) { return Promise.resolve({ sent: 0 }); }
}

/**
 * Rappel du soir : à 18 h (heure de Douala), chaque agent qui a une fiche du jour
 * non envoyée reçoit un rappel. Une seule fois par fiche et par jour.
 */
function doualaNow() {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: process.env.APP_TZ || 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
}

export function startReminders() {
  const hour = Number(process.env.PORT_REMINDER_HOUR || 18);
  const tick = () => {
    try {
      const now = doualaNow();
      if (now.hour < hour) return;
      const sheets = db.prepare(`
        SELECT s.id, s.sheet_no, s.created_by, (SELECT COUNT(*) FROM port_exit_rows r WHERE r.sheet_id = s.id) AS n
        FROM port_sheets s WHERE s.status = 'brouillon' AND s.sheet_date = ?`).all(now.date);
      for (const s of sheets) {
        const key = `reminder_${s.id}_${now.date}`;
        if (getSetting(key)) continue;
        setSetting(key, '1', 'system');
        notifyUser(s.created_by, {
          title: 'Fiche du jour non envoyée',
          body: s.n ? `${s.n} camion(s) saisis. Touchez pour vérifier et envoyer la fiche au bureau.` : 'Votre fiche du jour est vide. Ajoutez les sorties ou supprimez-la.',
          url: `/port?sheet=${s.id}`, tag: `reminder-${s.id}`, urgency: 'high'
        });
      }
    } catch (e) { console.error('[Notifications] Rappel:', e.message); }
  };
  setInterval(tick, 10 * 60 * 1000);
  setTimeout(tick, 15000);
}
