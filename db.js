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

  migrateAddColumnIfMissing('trips', 'bl_number', 'TEXT');
  migrateAddColumnIfMissing('trips', 'container_number', 'TEXT');
  migrateAddColumnIfMissing('trips', 'recette', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'marge_nette', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'dep_carburant', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'pesee', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'peage', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('trips', 'montant_remis', 'INTEGER DEFAULT 0');
  migrateAddColumnIfMissing('maintenance_records', 'document_url', 'TEXT');
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
