/**
 * Routes API pour les Analyses avancées — Rentabilité Routes & Comparaison Chauffeurs
 */
import express from 'express';
import { db } from '../db.js';

export const analyticsRouter = express.Router();

// GET /api/analytics/routes — Rentabilité par route
analyticsRouter.get('/routes', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (startDate && endDate) {
      where += ' AND trip_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      where += ' AND trip_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      where += ' AND trip_date <= ?';
      params.push(endDate);
    }

    const rows = db.prepare(`
      SELECT
        route,
        COUNT(id)                          AS nb_voyages,
        COALESCE(SUM(recette), 0)          AS recette_totale,
        COALESCE(SUM(montant_remis), 0)    AS remis_chauffeur_total,
        COALESCE(SUM(marge_nette), 0)      AS credit_entreprise_total,
        COALESCE(AVG(marge_nette), 0)      AS marge_nette_moyenne,
        CASE
          WHEN COALESCE(SUM(recette), 0) > 0
          THEN ROUND(CAST(COALESCE(SUM(marge_nette), 0) AS REAL) / COALESCE(SUM(recette), 0) * 100, 1)
          ELSE 0
        END                                AS taux_marge_pct
      FROM trips ${where}
      GROUP BY route
      ORDER BY credit_entreprise_total DESC
    `).all(...params);

    // Ajouter le rang
    const result = rows.map((r, i) => ({
      rang: i + 1,
      route: r.route || '(non renseignée)',
      nb_voyages: r.nb_voyages,
      recette_totale: r.recette_totale,
      remis_chauffeur_total: r.remis_chauffeur_total,
      credit_entreprise_total: r.credit_entreprise_total,
      marge_nette_moyenne: Math.round(r.marge_nette_moyenne),
      taux_marge_pct: r.taux_marge_pct
    }));

    res.json(result);
  } catch (err) {
    console.error('Erreur analytics/routes:', err);
    res.status(500).json({ error: 'Erreur lors du calcul de la rentabilité par route.' });
  }
});

// GET /api/analytics/drivers — Comparaison chauffeurs
analyticsRouter.get('/drivers', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let tripWhere = 'WHERE 1=1';
    let maintWhere = 'WHERE 1=1';
    const tripBaseParams = [];
    const maintBaseParams = [];

    if (startDate && endDate) {
      tripWhere += ' AND trip_date BETWEEN ? AND ?';
      maintWhere += ' AND record_date BETWEEN ? AND ?';
      tripBaseParams.push(startDate, endDate);
      maintBaseParams.push(startDate, endDate);
    } else if (startDate) {
      tripWhere += ' AND trip_date >= ?';
      maintWhere += ' AND record_date >= ?';
      tripBaseParams.push(startDate);
      maintBaseParams.push(startDate);
    } else if (endDate) {
      tripWhere += ' AND trip_date <= ?';
      maintWhere += ' AND record_date <= ?';
      tripBaseParams.push(endDate);
      maintBaseParams.push(endDate);
    }

    const drivers = db.prepare(`
      SELECT id, name, assigned_truck, is_active
      FROM drivers
      WHERE is_active = 1
      ORDER BY name ASC
    `).all();

    const result = drivers.map(driver => {
      // Données voyages
      const tripStats = db.prepare(`
        SELECT
          COUNT(id)                       AS nb_voyages,
          COALESCE(SUM(recette), 0)       AS recette_totale,
          COALESCE(SUM(marge_nette), 0)   AS credit_entreprise,
          COALESCE(SUM(dep_carburant), 0) AS carburant_voyage
        FROM trips ${tripWhere} AND driver_id = ?
      `).get(...tripBaseParams, driver.id);

      // Entretiens imputés au chauffeur
      const maintStats = db.prepare(`
        SELECT COALESCE(SUM(amount_fcfa), 0) AS cout_entretien
        FROM maintenance_records ${maintWhere} AND driver_id = ?
      `).get(...maintBaseParams, driver.id);

      const recette = tripStats.recette_totale;
      const credit = tripStats.credit_entreprise;
      const ratio = recette > 0 ? Math.round((credit / recette) * 1000) / 10 : 0;

      return {
        id: driver.id,
        name: driver.name,
        assigned_truck: driver.assigned_truck || '—',
        nb_voyages: tripStats.nb_voyages,
        recette_totale: recette,
        credit_entreprise: credit,
        cout_entretien: maintStats.cout_entretien,
        carburant_voyage: tripStats.carburant_voyage,
        ratio_credit_pct: ratio
      };
    });

    // Trier par crédit entreprise décroissant et ajouter le rang
    result.sort((a, b) => b.credit_entreprise - a.credit_entreprise);
    result.forEach((r, i) => { r.rang = i + 1; });

    res.json(result);
  } catch (err) {
    console.error('Erreur analytics/drivers:', err);
    res.status(500).json({ error: 'Erreur lors du classement des chauffeurs.' });
  }
});
