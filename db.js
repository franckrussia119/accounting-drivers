/**
 * Module de gestion de la base de données SQLite pour l'application de transport routier.
 * Supporte automatiquement better-sqlite3 ou le moteur natif node:sqlite.
 */
import fs from 'fs';
import path from 'path';

// Résolution du chemin du fichier de base de données
const dbFilePath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'flotte.db');
const dbDir = path.dirname(dbFilePath);

// Création du répertoire de données s'il n'existe pas
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let rawDb = null;
let engineType = '';

try {
  // Tentative avec better-sqlite3 en premier
  const BetterSqlite = (await import('better-sqlite3')).default;
  rawDb = new BetterSqlite(dbFilePath);
  engineType = 'better-sqlite3';
  console.log(`[Base de données] Connecté via better-sqlite3 : ${dbFilePath}`);
} catch (e) {
  // Fallback transparent vers node:sqlite natif (Node 22+)
  try {
    const { DatabaseSync } = await import('node:sqlite');
    rawDb = new DatabaseSync(dbFilePath);
    engineType = 'node:sqlite';
    console.log(`[Base de données] Connecté via node:sqlite natif : ${dbFilePath}`);
  } catch (err2) {
    console.error('[Base de données] Erreur critique: Impossible d\'initialiser SQLite', err2);
    throw err2;
  }
}

// Wrapper unifié pour garantir la compatibilité des requêtes préparées
export const db = {
  exec(sql) {
    return rawDb.exec(sql);
  },
  prepare(sql) {
    const stmt = rawDb.prepare(sql);
    return {
      all(...params) {
        return stmt.all(...params);
      },
      get(...params) {
        return stmt.get(...params);
      },
      run(...params) {
        const res = stmt.run(...params);
        return {
          changes: res?.changes ?? 0,
          lastInsertRowid: res?.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0
        };
      }
    };
  }
};

/**
 * Migration initiale et création des tables
 */
export function initDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    -- Table des camions de la flotte (10 camions)
    CREATE TABLE IF NOT EXISTS trucks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,            -- ex: 'TR-01'
      brand_model TEXT NOT NULL,           -- ex: 'Mercedes Actros 1845'
      license_plate TEXT NOT NULL,         -- ex: 'LT-842-AB'
      year INTEGER,
      current_km INTEGER DEFAULT 0,
      status TEXT DEFAULT 'actif',         -- 'actif', 'en_maintenance', 'inactif'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Table des chauffeurs
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      assigned_truck TEXT,                 -- Code camion assigné, ex: 'TR-01'
      is_contractor INTEGER DEFAULT 0,     -- 0 = Salarié, 1 = Sous-traitant
      is_active INTEGER DEFAULT 1,         -- 0 = Inactif, 1 = Actif
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Table des voyages / trajets (Trips)
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      truck_id TEXT NOT NULL,
      trip_date TEXT NOT NULL,             -- YYYY-MM-DD
      route TEXT NOT NULL,                 -- ex: 'Douala - Yaoundé'
      amount_fcfa INTEGER NOT NULL,        -- Montant reçu pour ce voyage en FCFA
      cargo TEXT,                          -- Marchandise transportée (ex: 'Conteneurs 40ft')
      bl_number TEXT,                      -- Numéro de BL / connaissement
      container_number TEXT,               -- Numéro de conteneur
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );

    -- Table des dépenses de carburant (Fuel)
    CREATE TABLE IF NOT EXISTS fuel_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      truck_id TEXT NOT NULL,
      expense_date TEXT NOT NULL,          -- YYYY-MM-DD
      liters REAL NOT NULL,
      amount_fcfa INTEGER NOT NULL,        -- Montant payé en FCFA
      station TEXT NOT NULL,               -- Station service / Lieu
      km_at_fill INTEGER,                  -- Kilométrage lors du plein
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );

    -- Table des interventions d'entretien et réparations (Maintenance)
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      truck_id TEXT NOT NULL,
      driver_id INTEGER,                   -- Chauffeur au moment de l'intervention
      record_date TEXT NOT NULL,           -- YYYY-MM-DD
      service_type TEXT NOT NULL,          -- 'vidange', 'pneus', 'freins', 'révision', 'panne', 'moteur', 'électricité', 'autre'
      description TEXT NOT NULL,           -- Ce qui a été réalisé
      amount_fcfa INTEGER NOT NULL,        -- Coût total en FCFA
      garage TEXT NOT NULL,                -- Nom du garage ou prestataire
      km INTEGER,                          -- Kilométrage
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE SET NULL
    );

    -- Table des autres dépenses liées à un chauffeur/camion (péage, amende,
    -- assurance, parking, etc.) — tout ce qui n'est ni carburant ni entretien
    CREATE TABLE IF NOT EXISTS other_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER,
      truck_id TEXT,
      expense_date TEXT NOT NULL,          -- YYYY-MM-DD
      category TEXT NOT NULL,              -- 'péage', 'amende', 'assurance', 'parking', 'autre', ...
      description TEXT NOT NULL,
      amount_fcfa INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE SET NULL
    );
  `);

  // Table des documents administratifs (camions + chauffeurs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('truck','driver')),
      entity_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      doc_name TEXT NOT NULL,
      file_url TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  migrateAddColumnIfMissing('trips', 'bl_number', 'TEXT');
  migrateAddColumnIfMissing('trips', 'container_number', 'TEXT');
  migrateAddColumnIfMissing('trips', 'client_name', 'TEXT');
  migrateAddColumnIfMissing('trips', 'recette', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'marge_nette', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'dep_carburant', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'pesee', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'peage', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'montant_remis', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('maintenance_records', 'document_url', 'TEXT');
  migrateAddColumnIfMissing('maintenance_records', 'line_items', 'TEXT');
  migrateAddColumnIfMissing('fleet_documents', 'amount_fcfa', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('fleet_documents', 'renewal_cost', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('fleet_documents', 'driver_id', 'INTEGER');

  // ── Tables multi-utilisateurs ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,          -- mot de passe en clair (pas de bcrypt requis ici)
      role TEXT NOT NULL DEFAULT 'viewer', -- 'superadmin' | 'editor' | 'viewer'
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,            -- 'CREATE' | 'UPDATE' | 'DELETE' | 'PDF_EXPORT' | 'LOGIN' | 'LOGOUT'
      entity TEXT,                     -- 'trip' | 'fuel' | 'maintenance' | 'expense' | 'driver' | 'truck' | 'user'
      entity_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Table des avances et remboursements chauffeurs
  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      advance_date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('avance','remboursement')),
      amount_fcfa INTEGER NOT NULL,
      motif TEXT NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );
  `);

  // ── Tables sous-traitants (transporteurs externes) ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS subcontractors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                  -- ex: 'Transport Bello SARL'
      contact TEXT,                        -- Nom du contact principal
      phone TEXT,
      email TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subcontractor_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subcontractor_id INTEGER NOT NULL,
      trip_date TEXT NOT NULL,             -- YYYY-MM-DD
      destination TEXT NOT NULL,           -- ex: 'Douala - Yaoundé'
      goods TEXT,                          -- Marchandise
      bl_number TEXT,
      container_number TEXT,
      client_revenue INTEGER NOT NULL DEFAULT 0,    -- Ce que le client paie à YM-TRANSIT
      subcontractor_cost INTEGER NOT NULL DEFAULT 0, -- Ce que YM-TRANSIT paie au sous-traitant
      margin INTEGER GENERATED ALWAYS AS (client_revenue - subcontractor_cost) VIRTUAL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE
    );
  `);

  // ── v4.31 : Affectations camion ↔ chauffeur (échanges) ────────────────────
  // Le chauffeur HABITUEL reste drivers.assigned_truck. Une ligne ici = un
  // échange temporaire : "du X au Y, le camion C est conduit par le chauffeur D".
  db.exec(`
    CREATE TABLE IF NOT EXISTS truck_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      truck_code TEXT NOT NULL,
      driver_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,            -- YYYY-MM-DD inclus
      end_date TEXT,                       -- YYYY-MM-DD inclus, NULL = en cours
      reason TEXT NOT NULL DEFAULT 'autre',-- maladie | panne | conge | remplacement | autre
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assign_truck ON truck_assignments(truck_code, start_date);
    CREATE INDEX IF NOT EXISTS idx_assign_driver ON truck_assignments(driver_id, start_date);

    -- ── v4.31 : Fiches de sortie port (saisies par l'agent au port) ─────────
    CREATE TABLE IF NOT EXISTS port_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_no TEXT UNIQUE NOT NULL,       -- YMT-PORT-20261026-01
      sheet_date TEXT NOT NULL,            -- YYYY-MM-DD
      port TEXT,
      agent_name TEXT,
      agent_phone TEXT,
      status TEXT NOT NULL DEFAULT 'brouillon', -- brouillon | soumis | valide
      notes TEXT,
      created_by TEXT,
      submitted_at TEXT,
      validated_by TEXT,
      validated_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS port_exit_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL,
      exit_time TEXT,                      -- HH:MM
      truck_code TEXT,                     -- code ou immatriculation saisie
      is_external INTEGER NOT NULL DEFAULT 0,
      subcontractor_id INTEGER,
      external_company TEXT,
      driver_id INTEGER,
      driver_name TEXT,                    -- texte libre (externe / inconnu)
      usual_driver_name TEXT,              -- chauffeur habituel noté par l'agent
      bl_number TEXT,
      container_number TEXT,
      container_size TEXT,                 -- '20' | '40' | '45'
      client_name TEXT,
      destination TEXT,
      carburant INTEGER DEFAULT 0,
      avance INTEGER DEFAULT 0,
      observations TEXT,
      status TEXT NOT NULL DEFAULT 'en_attente', -- en_attente | importe | rejete
      trip_id INTEGER,
      sub_trip_id INTEGER,
      reject_reason TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sheet_id) REFERENCES port_sheets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_port_rows_sheet ON port_exit_rows(sheet_id);

    -- ── v4.31 : Paramètres applicatifs (clé API Gemini, etc.) ──────────────
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  migrateAddColumnIfMissing('trips', 'usual_driver_id', 'INTEGER');
  migrateAddColumnIfMissing('trips', 'is_exchange', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'port_row_id', 'INTEGER');
  migrateAddColumnIfMissing('subcontractor_trips', 'port_row_id', 'INTEGER');
  migrateAddColumnIfMissing('port_exit_rows', 'advance_id', 'INTEGER');
  migrateAddColumnIfMissing('port_exit_rows', 'client_uid', 'TEXT');

  // ── v4.32 : profil utilisateur (repris automatiquement par l'appli agent) ──
  migrateAddColumnIfMissing('users', 'full_name', 'TEXT');
  migrateAddColumnIfMissing('users', 'phone', 'TEXT');
  migrateAddColumnIfMissing('users', 'default_port', 'TEXT');
  migrateAddColumnIfMissing('port_sheets', 'return_reason', 'TEXT');
  // v4.32 : l'agent note les frais de route remis au chauffeur (le carburant est saisi au bureau)
  migrateAddColumnIfMissing('port_exit_rows', 'frais_route', 'INTEGER DEFAULT 0');

  // ── v4.32 : abonnements aux notifications (Web Push) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_ok_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(username);
  `);
  // Rétro-remplissage : voyages existants sans chauffeur habituel connu →
  // on prend l'affectation actuelle du camion (meilleure information dispo).
  try {
    db.exec(`
      UPDATE trips
      SET usual_driver_id = (SELECT d.id FROM drivers d WHERE d.assigned_truck = trips.truck_id ORDER BY d.is_active DESC, d.id LIMIT 1)
      WHERE usual_driver_id IS NULL;
      UPDATE trips
      SET is_exchange = CASE WHEN usual_driver_id IS NOT NULL AND usual_driver_id <> driver_id THEN 1 ELSE 0 END
      WHERE is_exchange IS NULL OR is_exchange = 0;
    `);
  } catch (e) {
    console.error('[Base de données] Rétro-remplissage échanges:', e.message);
  }

  // Créer le super admin depuis les variables d'env si la table users est vide
  seedSuperAdmin();
}

/** Lecture / écriture des paramètres applicatifs */
export function getSetting(key, fallback = null) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row && row.value !== null && row.value !== '' ? row.value : fallback;
  } catch (e) {
    return fallback;
  }
}

export function setSetting(key, value, username) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, username || null);
}

/**
 * Connexion SQLite en LECTURE SEULE — utilisée par l'assistant IA.
 * Même si une requête générée était malveillante, le moteur refuse toute écriture.
 */
let _roDb = null;
export async function getReadonlyDb() {
  if (_roDb) return _roDb;
  try {
    const BetterSqlite = (await import('better-sqlite3')).default;
    const conn = new BetterSqlite(dbFilePath, { readonly: true, fileMustExist: true });
    _roDb = {
      all(sql) {
        const stmt = conn.prepare(sql);
        if (!stmt.reader) throw new Error('Seules les requêtes de lecture sont autorisées.');
        return stmt.all();
      }
    };
  } catch (e) {
    const { DatabaseSync } = await import('node:sqlite');
    const conn = new DatabaseSync(dbFilePath, { readOnly: true });
    _roDb = { all(sql) { return conn.prepare(sql).all(); } };
  }
  return _roDb;
}

/**
 * Insère le Super Admin au premier démarrage si aucun utilisateur n'existe.
 */
function seedSuperAdmin() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c === 0) {
    const username = process.env.AUTH_USERNAME || 'admin';
    const password = process.env.AUTH_PASSWORD || 'changeme123';
    db.prepare(`INSERT INTO users (username, password, role, created_by) VALUES (?, ?, 'superadmin', 'system')`).run(username, password);
    console.log(`[Base de données] Super Admin créé : "${username}"`);
  }
}

/**
 * Ajoute une colonne à une table existante si elle n'existe pas déjà —
 * nécessaire car CREATE TABLE IF NOT EXISTS n'ajoute pas de nouvelles
 * colonnes à une table deja presente sur une base de donnees existante
 * (deploiements anterieurs a l'ajout du champ).
 */
function migrateAddColumnIfMissing(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[Base de données] Migration: colonne "${column}" ajoutée à "${table}".`);
  }
}
