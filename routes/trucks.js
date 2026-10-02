/**
 * Routes API pour la gestion de la flotte de camions et l'historique d'entretien par camion
 */
import express from 'express';
import { db } from '../db.js';

export const trucksRouter = express.Router();

// Liste de tous les camions avec statistiques de coûts et chauffeur assigné
trucksRouter.get('/', (req, res) => {
  try {
    const trucks = db.prepare(`
      SELECT 
        t.*,
        d.name as driver_name,
        d.id as driver_id,
        (
          SELECT COALESCE(SUM(m.amount_fcfa), 0) 
          FROM maintenance_records m 
          WHERE m.truck_id = t.code
        ) as total_maintenance,
        (
          SELECT COUNT(m.id) 
          FROM maintenance_records m 
          WHERE m.truck_id = t.code
        ) as maintenance_count,
        (
          SELECT COALESCE(SUM(f.amount_fcfa), 0) 
          FROM fuel_expenses f 
          WHERE f.truck_id = t.code
        ) as total_fuel,
        (
          SELECT COALESCE(SUM(tr.amount_fcfa), 0) 
          FROM trips tr 
          WHERE tr.truck_id = t.code
        ) as total_revenue
      FROM trucks t
      LEFT JOIN drivers d ON d.assigned_truck = t.code
      ORDER BY t.code ASC
    `).all();

    const result = trucks.map(t => {
      const net = (t.total_revenue || 0) - (t.total_fuel || 0) - (t.total_maintenance || 0);
      return {
        ...t,
        net_profit: net
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Erreur get trucks:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des camions.' });
  }
});

// Création d'un camion
trucksRouter.post('/', (req, res) => {
  try {
    const { code, brand_model, license_plate, year, current_km, status } = req.body || {};
    if (!code || !code.trim() || !brand_model || !license_plate) {
      return res.status(400).json({ error: 'Le code camion, modèle et immatriculation sont obligatoires.' });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM trucks WHERE code = ?').get(cleanCode);
    if (existing) {
      return res.status(400).json({ error: `Le camion ${cleanCode} existe déjà.` });
    }

    const stmt = db.prepare(`
      INSERT INTO trucks (code, brand_model, license_plate, year, current_km, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      cleanCode,
      brand_model.trim(),
      license_plate.trim().toUpperCase(),
      year ? parseInt(year, 10) : null,
      current_km ? parseInt(current_km, 10) : 0,
      status || 'actif'
    );

    const newTruck = db.prepare('SELECT * FROM trucks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newTruck);
  } catch (err) {
    console.error('Erreur post truck:', err);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du camion.' });
  }
});

// Mise à jour d'un camion
trucksRouter.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM trucks WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Camion introuvable.' });
    }

    const { code, brand_model, license_plate, year, current_km, status } = req.body || {};

    const updatedCode = code ? code.trim().toUpperCase() : existing.code;
    const updatedModel = brand_model ? brand_model.trim() : existing.brand_model;
    const updatedPlate = license_plate ? license_plate.trim().toUpperCase() : existing.license_plate;
    const updatedYear = year !== undefined ? parseInt(year, 10) : existing.year;
    const updatedKm = current_km !== undefined ? parseInt(current_km, 10) : existing.current_km;
    const updatedStatus = status || existing.status;

    db.prepare(`
      UPDATE trucks 
      SET code = ?, brand_model = ?, license_plate = ?, year = ?, current_km = ?, status = ?
      WHERE id = ?
    `).run(updatedCode, updatedModel, updatedPlate, updatedYear, updatedKm, updatedStatus, id);

    const updated = db.prepare('SELECT * FROM trucks WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error('Erreur put truck:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du camion.' });
  }
});

// Historique d'entretien complet et coût de possession d'un camion spécifique
trucksRouter.get('/:code/maintenance', (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const truck = db.prepare(`
      SELECT t.*, d.name as driver_name 
      FROM trucks t
      LEFT JOIN drivers d ON d.assigned_truck = t.code
      WHERE t.code = ?
    `).get(code);

    if (!truck) {
      return res.status(404).json({ error: 'Camion introuvable.' });
    }

    // Toutes les interventions de maintenance pour ce camion
    const records = db.prepare(`
      SELECT 
        m.*,
        d.name as driver_name
      FROM maintenance_records m
      LEFT JOIN drivers d ON d.id = m.driver_id
      WHERE m.truck_id = ?
      ORDER BY m.record_date DESC, m.id DESC
    `).all(code);

    // Dépenses de carburant du camion
    const fuelExpenses = db.prepare(`
      SELECT 
        f.*,
        d.name as driver_name
      FROM fuel_expenses f
      LEFT JOIN drivers d ON d.id = f.driver_id
      WHERE f.truck_id = ?
      ORDER BY f.expense_date DESC
    `).all(code);

    // Recettes générées par le camion
    const trips = db.prepare(`
      SELECT 
        tr.*,
        d.name as driver_name
      FROM trips tr
      LEFT JOIN drivers d ON d.id = tr.driver_id
      WHERE tr.truck_id = ?
      ORDER BY tr.trip_date DESC
    `).all(code);

    const totalMaintenanceCost = records.reduce((sum, r) => sum + Number(r.amount_fcfa || 0), 0);
    const totalFuelCost = fuelExpenses.reduce((sum, f) => sum + Number(f.amount_fcfa || 0), 0);
    const totalFuelLiters = fuelExpenses.reduce((sum, f) => sum + Number(f.liters || 0), 0);
    const totalRevenue = trips.reduce((sum, tr) => sum + Number(tr.amount_fcfa || 0), 0);
    const totalOperatingCost = totalMaintenanceCost + totalFuelCost;
    const netProfit = totalRevenue - totalOperatingCost;

    // Répartition des coûts de maintenance par type d'intervention
    const byType = {};
    for (const r of records) {
      const type = r.service_type.toLowerCase();
      if (!byType[type]) {
        byType[type] = { type, count: 0, total_fcfa: 0 };
      }
      byType[type].count += 1;
      byType[type].total_fcfa += Number(r.amount_fcfa || 0);
    }

    res.json({
      truck,
      records,
      summary: {
        totalMaintenanceCost,
        maintenanceCount: records.length,
        totalFuelCost,
        totalFuelLiters,
        totalRevenue,
        totalOperatingCost,
        netProfit,
        byType: Object.values(byType).sort((a, b) => b.total_fcfa - a.total_fcfa)
      }
    });
  } catch (err) {
    console.error('Erreur get truck maintenance:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'historique d\'entretien.' });
  }
});

// Rapport complet d'un camion sur une plage de dates (pour PDF)
trucksRouter.get('/:code/report', (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const truck = db.prepare(`
      SELECT t.*, d.name as driver_name
      FROM trucks t
      LEFT JOIN drivers d ON d.assigned_truck = t.code
      WHERE t.code = ?
    `).get(code);

    if (!truck) {
      return res.status(404).json({ error: 'Camion introuvable.' });
    }

    const { startDate, endDate } = req.query;

    // Helpers de filtre de date
    const dateFilter = (col) => {
      if (startDate && endDate) return ` AND ${col} BETWEEN ? AND ?`;
      if (startDate) return ` AND ${col} >= ?`;
      if (endDate) return ` AND ${col} <= ?`;
      return '';
    };
    const dateParams = () => {
      if (startDate && endDate) return [startDate, endDate];
      if (startDate) return [startDate];
      if (endDate) return [endDate];
      return [];
    };

    // Voyages
    const trips = db.prepare(`
      SELECT tr.*, d.name as driver_name
      FROM trips tr
      LEFT JOIN drivers d ON d.id = tr.driver_id
      WHERE tr.truck_id = ? ${dateFilter('tr.trip_date')}
      ORDER BY tr.trip_date DESC
    `).all(code, ...dateParams());

    // Pleins carburant
    const fuel = db.prepare(`
      SELECT f.*, d.name as driver_name
      FROM fuel_expenses f
      LEFT JOIN drivers d ON d.id = f.driver_id
      WHERE f.truck_id = ? ${dateFilter('f.expense_date')}
      ORDER BY f.expense_date DESC
    `).all(code, ...dateParams());

    // Entretiens
    const maintenance = db.prepare(`
      SELECT m.*, d.name as driver_name
      FROM maintenance_records m
      LEFT JOIN drivers d ON d.id = m.driver_id
      WHERE m.truck_id = ? ${dateFilter('m.record_date')}
      ORDER BY m.record_date DESC
    `).all(code, ...dateParams());

    // Autres dépenses
    const otherExpenses = db.prepare(`
      SELECT e.*
      FROM other_expenses e
      WHERE e.truck_id = ? ${dateFilter('e.expense_date')}
      ORDER BY e.expense_date DESC
    `).all(code, ...dateParams());

    // Totaux voyages
    const totalRecette = trips.reduce((s, t) => s + Number(t.recette || 0), 0);
    const totalDepCarburant = trips.reduce((s, t) => s + Number(t.dep_carburant || 0), 0);
    const totalPesee = trips.reduce((s, t) => s + Number(t.pesee || 0), 0);
    const totalPeage = trips.reduce((s, t) => s + Number(t.peage || 0), 0);
    const totalMontantRemis = trips.reduce((s, t) => s + Number(t.montant_remis || 0), 0);
    const totalMargeNette = trips.reduce((s, t) => s + Number(t.marge_nette || 0), 0);

    // Totaux autres
    const totalFuelCost = fuel.reduce((s, f) => s + Number(f.amount_fcfa || 0), 0);
    const totalFuelLiters = fuel.reduce((s, f) => s + Number(f.liters || 0), 0);
    const totalMaintenance = maintenance.reduce((s, m) => s + Number(m.amount_fcfa || 0), 0);
    const totalOtherExpenses = otherExpenses.reduce((s, e) => s + Number(e.amount_fcfa || 0), 0);
    const totalDépenses = totalMontantRemis + totalFuelCost + totalMaintenance + totalOtherExpenses;
    const netProfit = totalRecette - totalDépenses;

    res.json({
      truck,
      period: { startDate: startDate || null, endDate: endDate || null },
      trips,
      fuel,
      maintenance,
      otherExpenses,
      summary: {
        totalTrips: trips.length,
        totalRecette,
        totalDepCarburant,
        totalPesee,
        totalPeage,
        totalMontantRemis,
        totalMargeNette,
        totalFuelCost,
        totalFuelLiters,
        totalMaintenance,
        totalOtherExpenses,
        totalDépenses,
        netProfit
      }
    });
  } catch (err) {
    console.error('Erreur get truck report:', err);
    res.status(500).json({ error: 'Erreur lors de la génération du rapport camion.' });
  }
});
