/**
 * v4.31 — Assistant IA (Google Gemini, offre gratuite)
 *
 * Fonctionnement :
 *   1. Gemini traduit la question (français ou anglais) en UNE requête SQL SELECT
 *   2. Le serveur vérifie la requête (lecture seule, tables autorisées) et
 *      l'exécute sur une connexion SQLite OUVERTE EN LECTURE SEULE
 *   3. Gemini rédige la réponse dans la langue de la question, à partir des
 *      vrais résultats — il ne peut pas inventer de chiffres
 *
 * La clé API se règle dans l'application (superadmin) ou via GEMINI_API_KEY.
 */
import express from 'express';
import { getSetting, setSetting, getReadonlyDb } from '../db.js';
import { requireRole, logAudit } from '../auth.js';
import { todayISO } from '../lib/assignments.js';

export const assistantRouter = express.Router();

const BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.8-flash';
// Si le modèle choisi est refusé ou retiré par Google, on essaie ceux-ci dans l'ordre
// (gemini-2.5-* n'est plus ouvert aux nouveaux comptes, gemini-2.0-* est arrêté).
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
const MAX_ROWS = 200;

function apiKey() { return getSetting('gemini_api_key', process.env.GEMINI_API_KEY || null); }
function model() { return getSetting('gemini_model', process.env.GEMINI_MODEL || DEFAULT_MODEL); }

// ── Tables visibles par l'assistant (jamais users / audit_log / app_settings) ──
const ALLOWED_TABLES = [
  'trucks', 'drivers', 'trips', 'fuel_expenses', 'maintenance_records', 'other_expenses',
  'driver_advances', 'subcontractors', 'subcontractor_trips', 'truck_assignments',
  'port_sheets', 'port_exit_rows', 'fleet_documents'
];
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension)\b/i;

const SCHEMA = `
Base SQLite d'une société de transport routier de conteneurs (YM-TRANSIT, Douala, Cameroun). Montants en FCFA (entiers). Dates texte 'YYYY-MM-DD'.

trucks(id, code TEXT ex 'TR-01' — identifiant utilisé partout, brand_model, license_plate, year, current_km, status 'actif'|'en_maintenance'|'inactif')
drivers(id, name, assigned_truck TEXT = trucks.code du camion HABITUEL, is_contractor 0/1, is_active 0/1, phone)
trips(id, driver_id → drivers.id = chauffeur qui a CONDUIT, truck_id TEXT = trucks.code, trip_date, route TEXT = trajet/destination,
      recette = montant facturé au client, dep_carburant, pesee, peage, montant_remis = dep_carburant+pesee+peage remis au chauffeur,
      marge_nette = recette - montant_remis, cargo, bl_number, container_number, client_name, notes,
      usual_driver_id → drivers.id chauffeur habituel du camion, is_exchange 1 si le chauffeur n'était pas le chauffeur habituel du camion)
      → un voyage = un conteneur transporté. Nombre de conteneurs = COUNT des voyages avec container_number non vide.
fuel_expenses(id, driver_id, truck_id = trucks.code, expense_date, liters, amount_fcfa, station, km_at_fill)  -- pleins en station
maintenance_records(id, truck_id = trucks.code, driver_id, record_date, service_type ex 'vidange','pneus','freins','panne', description, amount_fcfa, garage, km)
other_expenses(id, driver_id, truck_id, expense_date, category ex 'péage','amende','assurance', description, amount_fcfa)
driver_advances(id, driver_id, advance_date, type 'avance'|'remboursement', amount_fcfa, motif)  -- solde dû = SUM(avance) - SUM(remboursement)
subcontractors(id, name, contact, phone, is_active)  -- transporteurs externes
subcontractor_trips(id, subcontractor_id, trip_date, destination, goods, bl_number, container_number, client_revenue, subcontractor_cost, margin = client_revenue - subcontractor_cost)
truck_assignments(id, truck_code = trucks.code, driver_id, start_date, end_date NULL=en cours, reason 'maladie'|'panne'|'conge'|'remplacement'|'autre')
      → échanges temporaires : pendant la période, driver_id conduit truck_code à la place du chauffeur habituel
port_sheets(id, sheet_no, sheet_date, port, agent_name, status 'brouillon'|'soumis'|'valide')  -- fiches de sortie port
port_exit_rows(id, sheet_id, exit_time, truck_code, is_external, external_company, driver_id, driver_name, bl_number, container_number, container_size '20'|'40', client_name, destination, frais_route = frais de route remis par l'agent, avance, carburant (anciennes fiches), status 'en_attente'|'a_corriger'|'importe'|'rejete')
fleet_documents(id, entity_type 'truck'|'driver', entity_id, doc_type, doc_name, issue_date, expiry_date, amount_fcfa)  -- assurance, visite technique, permis...
`;

function dateContext() {
  const t = new Date(todayISO() + 'T12:00:00');
  const iso = d => d.toISOString().slice(0, 10);
  const dow = (t.getDay() + 6) % 7; // lundi = 0
  const monday = new Date(t); monday.setDate(t.getDate() - dow);
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);
  const monthStart = new Date(t.getFullYear(), t.getMonth(), 1, 12);
  const prevMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1, 12);
  const prevMonthEnd = new Date(t.getFullYear(), t.getMonth(), 0, 12);
  return `Aujourd'hui = ${iso(t)}. Cette semaine = ${iso(monday)} → ${iso(t)} (semaine du lundi). Semaine dernière = ${iso(lastMonday)} → ${iso(lastSunday)}. ` +
    `Ce mois = ${iso(monthStart)} → ${iso(t)}. Mois dernier = ${iso(prevMonthStart)} → ${iso(prevMonthEnd)}. Cette année = ${t.getFullYear()}-01-01 → ${iso(t)}.`;
}

// ── Appel Gemini ─────────────────────────────────────────────────────────────
const KEY_PROBLEM = /api[ _]?key|API_KEY_INVALID|unregistered callers|ACCESS_TOKEN_TYPE_UNSUPPORTED|credential|unauthenticated/i;

async function callModel(m, key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let resp;
  try {
    resp = await fetch(`${BASE_URL}/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    throw Object.assign(new Error('Impossible de joindre Google Gemini : le serveur n\'a pas accès à internet (ou délai dépassé).'), { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const g = data?.error?.message || `HTTP ${resp.status}`;
    const status = data?.error?.status || '';
    const err = new Error(g);
    err.http = resp.status;
    err.google = `${resp.status} ${status} — ${g}`.trim();
    if (resp.status === 429) err.code = 'QUOTA';
    else if ((resp.status === 400 || resp.status === 401 || resp.status === 403) && KEY_PROBLEM.test(g + ' ' + status)) err.code = 'BAD_KEY';
    else if (resp.status === 403 || resp.status === 404) err.code = 'MODEL'; // modèle non autorisé pour ce compte, ou retiré
    else err.code = 'API';
    throw err;
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw Object.assign(new Error(`Réponse vide de Gemini${reason ? ' (' + reason + ')' : ''}.`), { code: 'API' });
  }
  return text;
}

async function gemini(systemText, userText, { json = false, history = [] } = {}) {
  const key = apiKey();
  if (!key) throw Object.assign(new Error('NO_KEY'), { code: 'NO_KEY' });
  const contents = [
    ...history.slice(-6).map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text || '').slice(0, 2000) }] })),
    { role: 'user', parts: [{ text: userText }] }
  ];
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: { temperature: json ? 0 : 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) }
  };
  const first = model();
  const candidates = [first, ...FALLBACK_MODELS.filter(m => m !== first)];
  let lastErr = null;
  for (const m of candidates) {
    try {
      const text = await callModel(m, key, body);
      if (m !== first) { setSetting('gemini_model', m, 'auto'); console.log(`[Assistant] Modèle « ${first} » refusé → bascule automatique sur « ${m} ».`); }
      return text;
    } catch (e) {
      lastErr = e;
      if (e.code !== 'MODEL') break; // clé, quota ou réseau : changer de modèle n'y changera rien
    }
  }
  const g = lastErr.google ? ` [Google : ${lastErr.google}]` : '';
  if (lastErr.code === 'BAD_KEY') throw Object.assign(new Error(`Clé API refusée par Google.${g}`), { code: 'BAD_KEY' });
  if (lastErr.code === 'QUOTA') throw Object.assign(new Error(`Quota gratuit Gemini atteint pour le moment : réessayez dans une minute.${g}`), { code: 'QUOTA' });
  if (lastErr.code === 'MODEL') throw Object.assign(new Error(`Aucun modèle Gemini n'est autorisé pour cette clé.${g}`), { code: 'MODEL' });
  if (lastErr.code === 'NETWORK') throw lastErr;
  throw Object.assign(new Error(`Erreur Gemini.${g}`), { code: 'API' });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

// ── Garde-fous SQL ───────────────────────────────────────────────────────────
export function validateSql(raw) {
  let sql = String(raw || '').trim().replace(/;+\s*$/, '');
  if (!sql) return { error: 'Requête vide.' };
  if (sql.includes(';')) return { error: 'Une seule requête autorisée.' };
  if (!/^(select|with)\b/i.test(sql)) return { error: 'Seules les requêtes SELECT sont autorisées.' };
  if (FORBIDDEN.test(sql)) return { error: 'Mot-clé interdit dans la requête.' };
  if (/\b(users|audit_log|app_settings|sqlite_master|sqlite_schema)\b/i.test(sql)) return { error: 'Table non autorisée.' };
  // Toute table citée après FROM / JOIN doit être autorisée (les CTE déclarées sont tolérées)
  const ctes = new Set([...sql.matchAll(/(?:with|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map(m => m[1].toLowerCase()));
  for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)) {
    const t = m[1].toLowerCase();
    if (!ALLOWED_TABLES.includes(t) && !ctes.has(t)) return { error: `Table non autorisée : ${t}` };
  }
  if (!/\blimit\s+\d+\s*$/i.test(sql)) sql = `SELECT * FROM (${sql}) LIMIT ${MAX_ROWS}`;
  return { sql };
}

// Limite simple : 30 questions / 10 min / utilisateur (préserve le quota gratuit)
const hits = new Map();
function rateLimited(user) {
  const now = Date.now();
  const arr = (hits.get(user) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(user, arr);
  return arr.length > 30;
}

const SQL_SYSTEM = `Tu es l'analyste de données de YM-TRANSIT. Tu reçois une question en français ou en anglais.
${SCHEMA}
Règles :
- Réponds UNIQUEMENT en JSON : {"lang":"fr"|"en","sql":"<une requête SQLite SELECT>"} ou, si la question ne nécessite pas de données (salutation, aide), {"lang":"..","sql":null,"answer":"<réponse courte>"}.
- Une seule requête SELECT (WITH autorisé). Jamais de modification.
- Noms de chauffeurs : comparer sans casse et partiellement : LOWER(d.name) LIKE LOWER('%eric%').
- Camions : la question peut citer le code (TR-01) ou l'immatriculation : chercher dans trucks.code OU trucks.license_plate.
- "Combien de voyages / conteneurs / camions" → COUNT ; donner aussi des colonnes utiles (nom, total recette...).
- "Quels camions a conduit X" → DISTINCT truck_id depuis trips de ce chauffeur sur la période.
- Toujours filtrer par date quand la question cite une période ; utiliser les dates exactes ci-dessous.
- Inclure des noms lisibles (JOIN drivers) plutôt que des id.
- Si on demande une liste, ORDER BY pertinent et LIMIT 50.`;

const ANSWER_SYSTEM = `Tu es l'assistant de gestion de flotte de YM-TRANSIT. Tu réponds à la question à partir des RÉSULTATS fournis (issus de la base de données réelle).
- Réponds dans la langue de la question (français ou anglais).
- Commence par la réponse directe (le chiffre, le nom), puis 1 à 3 phrases de détail utiles. Pas de titre.
- Montants : format "1 250 000 FCFA". Dates : format lisible (lundi 20 octobre).
- N'invente RIEN : si les résultats sont vides, dis-le simplement et suggère une reformulation (période, orthographe du nom).
- Ne mentionne pas SQL ni la base de données.`;

// ═══════════════════════════════════════════════════════════════════════════
assistantRouter.get('/status', (req, res) => {
  const key = apiKey();
  res.json({
    configured: !!key,
    model: model(),
    key_hint: key ? `…${key.slice(-4)}` : null,
    can_configure: req.user.role === 'superadmin'
  });
});

assistantRouter.post('/settings', requireRole('superadmin'), (req, res) => {
  const { api_key, model: m } = req.body || {};
  if (api_key !== undefined) setSetting('gemini_api_key', String(api_key).trim(), req.user.username);
  if (m !== undefined && String(m).trim()) setSetting('gemini_model', String(m).trim(), req.user.username);
  logAudit({ username: req.user.username, role: req.user.role, action: 'UPDATE', entity: 'settings', detail: 'Réglages assistant IA modifiés', ip: req.ip });
  const key = apiKey();
  res.json({ configured: !!key, model: model(), key_hint: key ? `…${key.slice(-4)}` : null });
});

// Vérifier la clé : petite requête de test, renvoie le modèle qui fonctionne
assistantRouter.post('/test', requireRole('superadmin'), async (req, res) => {
  try {
    const text = await gemini('Réponds uniquement par le mot OK.', 'Test de connexion');
    res.json({ ok: true, model: model(), reply: text.slice(0, 40) });
  } catch (err) {
    if (err.code === 'NO_KEY') return res.status(412).json({ ok: false, error: 'Aucune clé enregistrée.' });
    res.status(502).json({ ok: false, error: err.message, code: err.code });
  }
});

assistantRouter.post('/ask', async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 600);
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!question) return res.status(400).json({ error: 'Posez une question.' });
  if (rateLimited(req.user.username)) return res.status(429).json({ error: 'Trop de questions en peu de temps — patientez quelques minutes.' });

  try {
    const ctx = dateContext();
    // Étape 1 : question → SQL
    const plan = parseJson(await gemini(`${SQL_SYSTEM}\n${ctx}`, question, { json: true, history }));
    if (!plan) return res.status(502).json({ error: "L'assistant n'a pas compris la question — reformulez." });
    if (!plan.sql) return res.json({ answer: plan.answer || "Je peux répondre aux questions sur les voyages, chauffeurs, camions, dépenses et échanges.", lang: plan.lang || 'fr' });

    // Étape 2 : exécution sécurisée (1 nouvel essai si erreur SQL)
    const ro = await getReadonlyDb();
    let sql = null, rows = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
      const candidate = attempt === 0 ? plan.sql : (parseJson(await gemini(`${SQL_SYSTEM}\n${ctx}`,
        `Question : ${question}\nTa requête précédente a échoué :\n${sql || plan.sql}\nErreur : ${lastErr}\nCorrige-la. Réponds en JSON {"lang":..,"sql":..}.`, { json: true })) || {}).sql;
      const v = validateSql(candidate);
      if (v.error) { lastErr = v.error; sql = candidate; continue; }
      sql = v.sql;
      try { rows = ro.all(sql); } catch (e) { lastErr = e.message; }
    }
    if (rows === null) return res.status(422).json({ error: "Je n'ai pas réussi à trouver ces informations — reformulez la question.", detail: lastErr });

    // Étape 3 : rédaction de la réponse à partir des vrais résultats
    const sample = JSON.stringify(rows.slice(0, 60));
    const answer = await gemini(`${ANSWER_SYSTEM}\n${ctx}`,
      `Question : ${question}\nRésultats (${rows.length} ligne(s)${rows.length > 60 ? ', 60 premières montrées' : ''}) :\n${sample}`);

    logAudit({ username: req.user.username, role: req.user.role, action: 'ASSISTANT', entity: 'assistant', detail: question.slice(0, 200), ip: req.ip });
    res.json({
      answer,
      lang: plan.lang || 'fr',
      sql,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rows: rows.slice(0, 100),
      row_count: rows.length
    });
  } catch (err) {
    if (err.code === 'NO_KEY') return res.status(412).json({ error: "L'assistant n'est pas encore activé : un administrateur doit coller la clé API Gemini (gratuite) dans les réglages.", code: 'NO_KEY' });
    if (['BAD_KEY', 'QUOTA', 'MODEL', 'NETWORK', 'API'].includes(err.code)) return res.status(502).json({ error: err.message, code: err.code });
    console.error('Erreur assistant:', err);
    res.status(500).json({ error: "Erreur de l'assistant." });
  }
});
