/**
 * Routes API pour la gestion des Chauffeurs et Comptes Chauffeurs
 */
import express from 'express';
import { db } from '../db.js';
import { buildBatchResolver } from '../lib/assignments.js';
import { requireRole, logAudit } from '../auth.js';

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
driversRouter.post('/', requireRole('superadmin', 'editor'), (req, res) => {
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

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'CREATE',
      entity: 'driver',
      entity_id: result.lastInsertRowid,
      detail: `Nouveau chauffeur : ${name.trim()}`,
      ip: req.ip
    });

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
driversRouter.put('/:id', requireRole('superadmin', 'editor'), (req, res) => {
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

    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'UPDATE',
      entity: 'driver',
      entity_id: id,
      detail: `Modification chauffeur : ${updatedName}`,
      ip: req.ip
    });

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
driversRouter.delete('/:id', requireRole('superadmin', 'editor'), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT name FROM drivers WHERE id = ?').get(id);
    db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
    logAudit({
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE',
      entity: 'driver',
      entity_id: id,
      detail: `Suppression chauffeur : ${existing ? existing.name : id}`,
      ip: req.ip
    });
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
             truck_id, cargo, bl_number, container_number, notes, is_exchange,
             (SELECT name FROM drivers ud WHERE ud.id = trips.usual_driver_id) AS usual_driver_name
      FROM trips
      WHERE driver_id = ? ${dateTripFilter}
      ORDER BY trip_date DESC
    `).all(...paramsTrip);

    // ── v4.31 : imputation DATÉE des dépenses camion ─────────────────────
    // Une dépense sans chauffeur explicite (driver_id NULL) est imputée au
    // chauffeur qui conduisait réellement le camion ce jour-là (échange
    // temporaire > voyage du jour > chauffeur habituel). Une dépense avec un
    // chauffeur explicite reste à ce chauffeur.
    const resolveAt = buildBatchResolver();
    const did = Number(id);
    const truckSet = new Set();
    if (driver.assigned_truck) truckSet.add(String(driver.assigned_truck).toUpperCase());
    db.prepare('SELECT DISTINCT UPPER(truck_code) AS c FROM truck_assignments WHERE driver_id = ?').all(id).forEach(r => truckSet.add(r.c));
    db.prepare('SELECT DISTINCT UPPER(truck_id) AS c FROM trips WHERE driver_id = ?').all(id).forEach(r => truckSet.add(r.c));
    const trucksList = [...truckSet];
    const inTrucks = trucksList.length ? `OR (driver_id IS NULL AND UPPER(truck_id) IN (${trucksList.map(() => '?').join(',')}))` : '';
    const dateClause = (col) => {
      if (startDate && endDate) return { sql: ` AND ${col} BETWEEN ? AND ?`, p: [startDate, endDate] };
      if (startDate) return { sql: ` AND ${col} >= ?`, p: [startDate] };
      if (endDate) return { sql: ` AND ${col} <= ?`, p: [endDate] };
      return { sql: '', p: [] };
    };
    const attribute = (rows, dateCol) => rows
      .map(r => {
        if (r.driver_id !== null && r.driver_id !== undefined) {
          return Number(r.driver_id) === did ? { ...r, attribution: 'direct' } : null;
        }
        const who = resolveAt(r.truck_id, r[dateCol]);
        if (who !== did) return null;
        const own = driver.assigned_truck && String(r.truck_id).toUpperCase() === String(driver.assigned_truck).toUpperCase();
        return { ...r, attribution: own ? 'camion' : 'echange' };
      })
      .filter(Boolean);

    // 2. Carburant station
    const fd = dateClause('expense_date');
    const fuel = attribute(db.prepare(`
      SELECT id, expense_date, expense_date as date, liters, amount_fcfa, station, truck_id, km_at_fill, notes, driver_id
      FROM fuel_expenses
      WHERE (driver_id = ? ${inTrucks}) ${fd.sql}
      ORDER BY expense_date DESC
    `).all(id, ...trucksList, ...fd.p), 'expense_date');

    // 3. Entretiens
    const md = dateClause('record_date');
    const maintenance = attribute(db.prepare(`
      SELECT id, record_date, record_date as date, service_type, description, amount_fcfa, garage, truck_id, km, line_items, driver_id
      FROM maintenance_records
      WHERE (driver_id = ? ${inTrucks}) ${md.sql}
      ORDER BY record_date DESC
    `).all(id, ...trucksList, ...md.p), 'record_date');

    // 4. Autres dépenses (péage, amende, assurance...)
    const ed = dateClause('expense_date');
    const otherExpenses = attribute(db.prepare(`
      SELECT id, expense_date, expense_date as date, category, description, amount_fcfa, truck_id, notes, driver_id
      FROM other_expenses
      WHERE (driver_id = ? ${inTrucks}) ${ed.sql}
      ORDER BY expense_date DESC
    `).all(id, ...trucksList, ...ed.p), 'expense_date');

    // 5. Échanges : voyages sur d'autres camions + son camion conduit par d'autres
    const td = dateClause('t.trip_date');
    const tripsOnOtherTrucks = db.prepare(`
      SELECT t.id, t.trip_date, t.truck_id, t.route, t.recette, t.marge_nette, t.container_number, ud.name AS usual_driver_name
      FROM trips t LEFT JOIN drivers ud ON ud.id = t.usual_driver_id
      WHERE t.driver_id = ? AND t.is_exchange = 1 ${td.sql}
      ORDER BY t.trip_date DESC
    `).all(id, ...td.p);
    const othersOnMyTruck = driver.assigned_truck ? db.prepare(`
      SELECT t.id, t.trip_date, t.truck_id, t.route, t.recette, t.marge_nette, t.container_number, d.name AS driver_name
      FROM trips t JOIN drivers d ON d.id = t.driver_id
      WHERE UPPER(t.truck_id) = UPPER(?) AND t.driver_id <> ? ${td.sql}
      ORDER BY t.trip_date DESC
    `).all(driver.assigned_truck, id, ...td.p) : [];
    const aStart = startDate || '0000-01-01';
    const aEnd = endDate || '9999-12-31';
    const assignmentPeriods = db.prepare(`
      SELECT a.*, d.name AS driver_name,
        CASE WHEN a.driver_id = ? THEN 'remplace' ELSE 'remplace_par' END AS role
      FROM truck_assignments a JOIN drivers d ON d.id = a.driver_id
      WHERE (a.driver_id = ? OR UPPER(a.truck_code) = UPPER(?))
        AND a.start_date <= ? AND COALESCE(a.end_date, '9999-12-31') >= ?
      ORDER BY a.start_date DESC
    `).all(id, id, driver.assigned_truck || '__none__', aEnd, aStart);
    const exchanges = {
      tripsOnOtherTrucks,
      othersOnMyTruck,
      assignmentPeriods,
      count: tripsOnOtherTrucks.length,
      recetteOnOtherTrucks: tripsOnOtherTrucks.reduce((s2, t) => s2 + Number(t.recette || 0), 0),
      recetteOthersOnMyTruck: othersOnMyTruck.reduce((s2, t) => s2 + Number(t.recette || 0), 0),
      expensesFromExchange: [...fuel, ...maintenance, ...otherExpenses].filter(r => r.attribution === 'echange').reduce((s2, r) => s2 + Number(r.amount_fcfa || 0), 0)
    };

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
        subtitle: `Camion: ${t.truck_id}${t.is_exchange ? ' (échange — camion de ' + (t.usual_driver_name || '?') + ')' : ''}${t.cargo ? ' • ' + t.cargo : ''}${t.container_number ? ' • Conteneur: ' + t.container_number : ''}${t.bl_number ? ' • BL: ' + t.bl_number : ''}`,
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
        subtitle: `${f.station} • Camion: ${f.truck_id}${f.km_at_fill ? ' • ' + f.km_at_fill.toLocaleString('fr-FR') + ' km' : ''}${f.attribution === 'echange' ? ' • imputé (il conduisait ce camion)' : ''}`,
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
        subtitle: `${m.garage} • Camion: ${m.truck_id}${m.km ? ' • ' + m.km.toLocaleString('fr-FR') + ' km' : ''}${m.attribution === 'echange' ? ' • imputé (il conduisait ce camion)' : ''}`,
        amount: Number(m.amount_fcfa),
        isCredit: false, // Dépense
        details: `Type: ${m.service_type}`,
        line_items: m.line_items || null
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
        netBalance,
        exchangeTripsCount: exchanges.count
      },
      timeline,
      exchanges,
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
