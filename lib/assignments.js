/**
 * v4.31 — Logique d'échange camion ↔ chauffeur.
 *
 * Qui conduisait le camion C à la date D ?  Ordre de priorité :
 *   1. Un échange temporaire (truck_assignments) couvrant la date D
 *   2. Un voyage enregistré ce jour-là avec ce camion (le chauffeur du voyage)
 *   3. Le chauffeur habituel (drivers.assigned_truck)
 *
 * Cette règle sert à imputer correctement les dépenses "camion" (entretien,
 * carburant station, péage...) qui n'ont pas de chauffeur explicite.
 */
import { db } from '../db.js';

export const REASONS = {
  maladie: 'Maladie',
  panne: 'Camion en panne',
  conge: 'Congé / absence',
  remplacement: 'Remplacement',
  autre: 'Autre'
};

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Chauffeur habituel d'un camion (affectation permanente) */
export function habitualDriver(truckCode) {
  if (!truckCode) return null;
  return db.prepare(`
    SELECT id, name, phone FROM drivers
    WHERE UPPER(assigned_truck) = UPPER(?)
    ORDER BY is_active DESC, id ASC LIMIT 1
  `).get(String(truckCode).trim()) || null;
}

/** Échange temporaire actif pour un camion à une date */
export function activeAssignment(truckCode, date) {
  if (!truckCode || !date) return null;
  return db.prepare(`
    SELECT a.*, d.name AS driver_name
    FROM truck_assignments a JOIN drivers d ON d.id = a.driver_id
    WHERE UPPER(a.truck_code) = UPPER(?)
      AND a.start_date <= ?
      AND (a.end_date IS NULL OR a.end_date >= ?)
    ORDER BY a.start_date DESC, a.id DESC LIMIT 1
  `).get(String(truckCode).trim(), date, date) || null;
}

/** Échange temporaire actif pour un CHAUFFEUR à une date (il conduit un autre camion) */
export function activeAssignmentForDriver(driverId, date) {
  if (!driverId || !date) return null;
  return db.prepare(`
    SELECT a.* FROM truck_assignments a
    WHERE a.driver_id = ? AND a.start_date <= ? AND (a.end_date IS NULL OR a.end_date >= ?)
    ORDER BY a.start_date DESC LIMIT 1
  `).get(driverId, date, date) || null;
}

/**
 * Résout le chauffeur effectif d'un camion à une date.
 * @returns {{ driver_id, driver_name, source, habitual, assignment, is_exchange }}
 */
export function resolveDriver(truckCode, date) {
  const habitual = habitualDriver(truckCode);
  const assignment = activeAssignment(truckCode, date);
  if (assignment) {
    return {
      driver_id: assignment.driver_id,
      driver_name: assignment.driver_name,
      source: 'echange',
      habitual,
      assignment,
      is_exchange: !habitual || habitual.id !== assignment.driver_id
    };
  }
  const trip = db.prepare(`
    SELECT t.driver_id, d.name AS driver_name FROM trips t JOIN drivers d ON d.id = t.driver_id
    WHERE UPPER(t.truck_id) = UPPER(?) AND t.trip_date = ? ORDER BY t.id DESC LIMIT 1
  `).get(String(truckCode || '').trim(), date);
  if (trip) {
    return {
      driver_id: trip.driver_id,
      driver_name: trip.driver_name,
      source: 'voyage',
      habitual,
      assignment: null,
      is_exchange: !!habitual && habitual.id !== trip.driver_id
    };
  }
  return {
    driver_id: habitual ? habitual.id : null,
    driver_name: habitual ? habitual.name : null,
    source: habitual ? 'habituel' : 'aucun',
    habitual,
    assignment: null,
    is_exchange: false
  };
}

/**
 * Résolveur en lot (préchargé une fois) — pour les rapports qui parcourent
 * des centaines de lignes. Retourne fn(truckCode, date) → driver_id | null.
 */
export function buildBatchResolver() {
  const habitualMap = new Map();
  db.prepare(`SELECT id, assigned_truck FROM drivers WHERE assigned_truck IS NOT NULL AND assigned_truck <> '' ORDER BY is_active ASC, id DESC`)
    .all()
    .forEach(d => habitualMap.set(String(d.assigned_truck).toUpperCase(), d.id)); // le dernier écrit = actif & plus petit id
  const assignments = db.prepare(`SELECT truck_code, driver_id, start_date, end_date FROM truck_assignments ORDER BY start_date DESC, id DESC`).all();
  const tripMap = new Map();
  db.prepare(`SELECT truck_id, trip_date, driver_id FROM trips ORDER BY id ASC`).all()
    .forEach(t => tripMap.set(`${String(t.truck_id).toUpperCase()}|${t.trip_date}`, t.driver_id));

  return function resolve(truckCode, date) {
    if (!truckCode) return null;
    const code = String(truckCode).toUpperCase();
    if (date) {
      const a = assignments.find(x => String(x.truck_code).toUpperCase() === code && x.start_date <= date && (!x.end_date || x.end_date >= date));
      if (a) return a.driver_id;
      const t = tripMap.get(`${code}|${date}`);
      if (t) return t;
    }
    return habitualMap.get(code) ?? null;
  };
}

/** Vérifie qu'un nouvel échange ne chevauche pas un autre échange du même camion */
export function findOverlap(truckCode, start, end, excludeId = null) {
  const endVal = end || '9999-12-31';
  return db.prepare(`
    SELECT a.*, d.name AS driver_name FROM truck_assignments a JOIN drivers d ON d.id = a.driver_id
    WHERE UPPER(a.truck_code) = UPPER(?)
      AND a.start_date <= ?
      AND COALESCE(a.end_date, '9999-12-31') >= ?
      ${excludeId ? 'AND a.id <> ?' : ''}
    LIMIT 1
  `).get(...[truckCode, endVal, start, ...(excludeId ? [excludeId] : [])]) || null;
}
