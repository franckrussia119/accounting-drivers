/**
 * Routes API pour la gestion des Chauffeurs et Comptes Chauffeurs
 */
import express from 'express';
import { db } from '../db.js';

export const driversRouter = express.Router();

// Liste de tous les chauffeurs avec statistiques globales
driversRouter.get('/', (req, res) => {
  try {
    const drivers = db.prepare(`
      SELECT 
        d.*,
        COUNT(DISTINCT t.id) as total_trips,
        COALESCE(SUM(t.amount_fcfa), 0) as total_revenue,
        (
          SELECT COALESCE(SUM(f.amount_fcfa), 0) 
          FROM fuel_expenses f 
          WHERE f.driver_id = d.id
        ) as total_fuel,
        (
          SELECT COALESCE(SUM(m.amount_fcfa), 0) 
          FROM maintenance_records m 
          WHERE m.driver_id = d.id
        ) as total_maintenance,
        (
          SELECT COALESCE(SUM(e.amount_fcfa), 0) 
          FROM other_expenses e 
          WHERE e.driver_id = d.id
        ) as total_other_expenses
      FROM drivers d
      LEFT JOIN trips t ON t.driver_id = d.id
      GROUP BY d.id
      ORDER BY d.is_active DESC, d.name ASC
    `).all();

    const result = drivers.map(d => ({
      ...d,
      is_contractor: Boolean(d.is_contractor),
      is_active: Boolean(d.is_active),
      net_balance: (d.total_revenue || 0) - (d.total_fuel || 0) - (d.total_maintenance || 0) - (d.total_other_expenses || 0)
    }));

    res.json(result);
  } catch (err) {
    console.error('Erreur get drivers:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des chauffeurs.' });
  }
});

// Récupération d'un chauffeur par ID
driversRouter.get('/:id', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: 'Chauffeur introuvable.' });
    }
    res.json({
      ...driver,
      is_contractor: Boolean(driver.is_contractor),
      is_active: Boolean(driver.is_active)
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Création d'un nouveau chauffeur
driversRouter.post('/', (req, res) => {
  try {
    const { name, assigned_truck, is_contractor, is_active, phone } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom du chauffeur est obligatoire.' });
    }

    const stmt = db.prepare(`
      INSERT INTO drivers (name, assigned_truck, is_contractor, is_active, phone)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name.trim(),
      assigned_truck ? assigned_truck.trim() : null,
      is_contractor ? 1 : 0,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      phone ? phone.trim() : null
    );

    const newDriver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      ...newDriver,
      is_contractor: Boolean(newDriver.is_contractor),
      is_active: Boolean(newDriver.is_active)
    });
  } catch (err) {
    console.error('Erreur post driver:', err);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du chauffeur.' });
  }
});

// Mise à jour inline d'un chauffeur (sans prompt)
driversRouter.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Chauffeur introuvable.' });
    }

    const { name, assigned_truck, is_contractor, is_active, phone } = req.body || {};

    const updatedName = name !== undefined ? name.trim() : existing.name;
    const updatedTruck = assigned_truck !== undefined ? (assigned_truck ? assigned_truck.trim() : null) : existing.assigned_truck;
    const updatedContractor = is_contractor !== undefined ? (is_contractor ? 1 : 0) : existing.is_contractor;
    const updatedActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;
    const updatedPhone = phone !== undefined ? (phone ? phone.trim() : null) : existing.phone;

    db.prepare(`
      UPDATE drivers 
      SET name = ?, assigned_truck = ?, is_contractor = ?, is_active = ?, phone = ?
      WHERE id = ?
    `).run(updatedName, updatedTruck, updatedContractor, updatedActive, updatedPhone, id);

    const updated = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    res.json({
      ...updated,
      is_contractor: Boolean(updated.is_contractor),
      is_active: Boolean(updated.is_active)
    });
  } catch (err) {
    console.error('Erreur put driver:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du chauffeur.' });
  }
});

// Suppression d'un chauffeur
driversRouter.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
    res.json({ success: true, message: 'Chauffeur supprimé avec succès.' });
  } catch (err) {
    console.error('Erreur delete driver:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// Compte individuel détaillé d'un chauffeur sur une plage de dates
driversRouter.get('/:id/account', (req, res) => {
  try {
    const id = req.params.id;
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    if (!driver) {
      return res.status(404).json({ error: 'Chauffeur introuvable.' });
    }

    const { startDate, endDate } = req.query;

    let dateTripFilter = '';
    let dateFuelFilter = '';
    let dateMaintFilter = '';
    let dateExpenseFilter = '';
    const paramsTrip = [id];
    const paramsFuel = [id];
    const paramsMaint = [id];
    const paramsExpense = [id];

    if (startDate && endDate) {
      dateTripFilter = ' AND trip_date BETWEEN ? AND ?';
      paramsTrip.push(startDate, endDate);

      dateFuelFilter = ' AND expense_date BETWEEN ? AND ?';
      paramsFuel.push(startDate, endDate);

      dateMaintFilter = ' AND record_date BETWEEN ? AND ?';
      paramsMaint.push(startDate, endDate);

      dateExpenseFilter = ' AND expense_date BETWEEN ? AND ?';
      paramsExpense.push(startDate, endDate);
    } else if (startDate) {
      dateTripFilter = ' AND trip_date >= ?';
      paramsTrip.push(startDate);

      dateFuelFilter = ' AND expense_date >= ?';
      paramsFuel.push(startDate);

      dateMaintFilter = ' AND record_date >= ?';
      paramsMaint.push(startDate);

      dateExpenseFilter = ' AND expense_date >= ?';
      paramsExpense.push(startDate);
    } else if (endDate) {
      dateTripFilter = ' AND trip_date <= ?';
      paramsTrip.push(endDate);

      dateFuelFilter = ' AND expense_date <= ?';
      paramsFuel.push(endDate);

      dateMaintFilter = ' AND record_date <= ?';
      paramsMaint.push(endDate);

      dateExpenseFilter = ' AND expense_date <= ?';
      paramsExpense.push(endDate);
    }

    // 1. Tous les voyages du chauffeur
    const trips = db.prepare(`
      SELECT id, trip_date, trip_date as date, route, amount_fcfa, recette, marge_nette,
             COALESCE(dep_carburant,0) as dep_carburant, COALESCE(pesee,0) as pesee,
             COALESCE(peage,0) as peage, COALESCE(montant_remis,amount_fcfa) as montant_remis,
             truck_id, cargo, bl_number, container_number, notes
      FROM trips
      WHERE driver_id = ? ${dateTripFilter}
      ORDER BY trip_date DESC
    `).all(...paramsTrip);

    // 2. Toutes les dépenses de carburant
    const fuel = db.prepare(`
      SELECT id, expense_date, expense_date as date, liters, amount_fcfa, station, truck_id, km_at_fill, notes
      FROM fuel_expenses
      WHERE driver_id = ? ${dateFuelFilter}
      ORDER BY expense_date DESC
    `).all(...paramsFuel);

    // 3. Toutes les interventions d'entretien associées au chauffeur ou à son camion assigné
    // Si une intervention a driver_id = ce chauffeur OU (driver_id IS NULL et truck_id = camion assigné)
    let maintQuery = '';
    const maintParams = [];
    if (driver.assigned_truck) {
      maintQuery = `
        SELECT id, record_date, record_date as date, service_type, description, amount_fcfa, garage, truck_id, km
        FROM maintenance_records
        WHERE (driver_id = ? OR truck_id = ?)
      `;
      maintParams.push(id, driver.assigned_truck);
    } else {
      maintQuery = `
        SELECT id, record_date, record_date as date, service_type, description, amount_fcfa, garage, truck_id, km
        FROM maintenance_records
        WHERE driver_id = ?
      `;
      maintParams.push(id);
    }

    if (startDate && endDate) {
      maintQuery += ' AND record_date BETWEEN ? AND ?';
      maintParams.push(startDate, endDate);
    } else if (startDate) {
      maintQuery += ' AND record_date >= ?';
      maintParams.push(startDate);
    } else if (endDate) {
      maintQuery += ' AND record_date <= ?';
      maintParams.push(endDate);
    }
    maintQuery += ' ORDER BY record_date DESC';

    const maintenance = db.prepare(maintQuery).all(...maintParams);

    // 4. Toutes les "autres dépenses" (péage, amende, assurance, etc.) liées
    // au chauffeur ou à son camion assigné
    let expenseQuery = '';
    const expenseParams = [];
    if (driver.assigned_truck) {
      expenseQuery = `
        SELECT id, expense_date, expense_date as date, category, description, amount_fcfa, truck_id, notes
        FROM other_expenses
        WHERE (driver_id = ? OR truck_id = ?)
      `;
      expenseParams.push(id, driver.assigned_truck);
    } else {
      expenseQuery = `
        SELECT id, expense_date, expense_date as date, category, description, amount_fcfa, truck_id, notes
        FROM other_expenses
        WHERE driver_id = ?
      `;
      expenseParams.push(id);
    }

    if (startDate && endDate) {
      expenseQuery += ' AND expense_date BETWEEN ? AND ?';
      expenseParams.push(startDate, endDate);
    } else if (startDate) {
      expenseQuery += ' AND expense_date >= ?';
      expenseParams.push(startDate);
    } else if (endDate) {
      expenseQuery += ' AND expense_date <= ?';
      expenseParams.push(endDate);
    }
    expenseQuery += ' ORDER BY expense_date DESC';

    const otherExpenses = db.prepare(expenseQuery).all(...expenseParams);

    // Totaux
    const totalTripsCount = trips.length;
    const totalRecette = trips.reduce((sum, t) => sum + Number(t.recette || 0), 0);
    const totalDepCarburant = trips.reduce((sum, t) => sum + Number(t.dep_carburant || 0), 0);
    const totalPesee = trips.reduce((sum, t) => sum + Number(t.pesee || 0), 0);
    const totalPeage = trips.reduce((sum, t) => sum + Number(t.peage || 0), 0);
    const totalMontantRemis = trips.reduce((sum, t) => sum + Number(t.montant_remis || 0), 0);
    const totalMargeNette = trips.reduce((sum, t) => sum + Number(t.marge_nette || 0), 0);
    // totalRevenue kept for backward compat = sum of montant_remis (what was given to driver)
    const totalRevenue = totalMontantRemis;
    const totalFuel = fuel.reduce((sum, f) => sum + Number(f.amount_fcfa || 0), 0);
    const totalFuelLiters = fuel.reduce((sum, f) => sum + Number(f.liters || 0), 0);
    const totalMaintenance = maintenance.reduce((sum, m) => sum + Number(m.amount_fcfa || 0), 0);
    const totalOtherExpenses = otherExpenses.reduce((sum, e) => sum + Number(e.amount_fcfa || 0), 0);
    const totalDépenses = totalMontantRemis + totalMaintenance + totalOtherExpenses;
    const netBalance = totalRecette - totalDépenses;
    // Crédit entreprise = recette totale - total remis chauffeur - autres dépenses
    const creditEntreprise = totalRecette - totalMontantRemis - totalMaintenance - totalOtherExpenses;

    // Flux chronologique unifié (Trips + Fuel + Maintenance + Autres Dépenses)
    const timeline = [
      ...trips.map(t => ({
        type: 'trip',
        typeLabel: 'Voyage',
        badgeColor: 'emerald',
        id: t.id,
        date: t.date,
        title: t.route,
        subtitle: `Camion: ${t.truck_id}${t.cargo ? ' • ' + t.cargo : ''}${t.container_number ? ' • Conteneur: ' + t.container_number : ''}${t.bl_number ? ' • BL: ' + t.bl_number : ''}`,
        amount: Number(t.recette || 0),
        montantRemis: Number(t.montant_remis || 0),
        depCarburant: Number(t.dep_carburant || 0),
        pesee: Number(t.pesee || 0),
        peage: Number(t.peage || 0),
        margeNette: Number(t.marge_nette || 0),
        isCredit: true, // Revenu
        details: t.notes || ''
      })),
      ...fuel.map(f => ({
        type: 'fuel',
        typeLabel: 'Carburant',
        badgeColor: 'amber',
        id: f.id,
        date: f.date,
        title: `Plein gasoil (${f.liters} L)`,
        subtitle: `${f.station} • Camion: ${f.truck_id}${f.km_at_fill ? ' • ' + f.km_at_fill.toLocaleString('fr-FR') + ' km' : ''}`,
        amount: Number(f.amount_fcfa),
        isCredit: false, // Dépense
        details: f.notes || ''
      })),
      ...maintenance.map(m => ({
        type: 'maintenance',
        typeLabel: m.service_type.toUpperCase(),
        badgeColor: 'rose',
        id: m.id,
        date: m.date,
        title: m.description,
        subtitle: `${m.garage} • Camion: ${m.truck_id}${m.km ? ' • ' + m.km.toLocaleString('fr-FR') + ' km' : ''}`,
        amount: Number(m.amount_fcfa),
        isCredit: false, // Dépense
        details: `Type: ${m.service_type}`
      })),
      ...otherExpenses.map(e => ({
        type: 'expense',
        typeLabel: e.category.toUpperCase(),
        badgeColor: 'violet',
        id: e.id,
        date: e.date,
        title: e.description,
        subtitle: `${e.truck_id ? 'Camion: ' + e.truck_id : 'Dépense générale'}`,
        amount: Number(e.amount_fcfa),
        isCredit: false, // Dépense
        details: e.notes || ''
      }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({
      driver: {
        ...driver,
        is_contractor: Boolean(driver.is_contractor),
        is_active: Boolean(driver.is_active)
      },
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      summary: {
        totalTripsCount,
        totalRevenue,
        totalRecette,
        totalDepCarburant,
        totalPesee,
        totalPeage,
        totalMontantRemis,
        totalMargeNette,
        totalFuel,
        totalFuelLiters,
        totalMaintenance,
        totalOtherExpenses,
        totalDépenses,
        creditEntreprise,
        netBalance
      },
      timeline,
      trips,
      fuel,
      maintenance,
      otherExpenses
    });
  } catch (err) {
    console.error('Erreur get driver account:', err);
    res.status(500).json({ error: 'Erreur lors du calcul du compte chauffeur.' });
  }
});
