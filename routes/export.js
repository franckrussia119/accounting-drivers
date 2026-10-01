/**
 * Routes API pour l'Export CSV avec respect des filtres actifs
 */
import express from 'express';
import { db } from '../db.js';

export const exportRouter = express.Router();

function sanitizeCsv(str) {
  if (str === null || str === undefined) return '';
  const stringified = String(str).replace(/"/g, '""');
  if (stringified.includes(';') || stringified.includes('"') || stringified.includes('\n')) {
    return `"${stringified}"`;
  }
  return stringified;
}

exportRouter.get('/csv', (req, res) => {
  try {
    const { type, driver_id, truck_id, service_type, startDate, endDate } = req.query;
    const nowStr = new Date().toISOString().slice(0, 10);

    let csvContent = '\uFEFF'; // UTF-8 BOM pour ouverture directe et propre dans Microsoft Excel
    let filename = `export_${type || 'donnees'}_${nowStr}.csv`;

    if (type === 'trips') {
      filename = `voyages_${nowStr}.csv`;
      let query = `
        SELECT t.*, d.name as driver_name 
        FROM trips t 
        JOIN drivers d ON d.id = t.driver_id 
        WHERE 1=1
      `;
      const params = [];
      if (driver_id) { query += ' AND t.driver_id = ?'; params.push(driver_id); }
      if (truck_id) { query += ' AND t.truck_id = ?'; params.push(truck_id); }
      if (startDate && endDate) { query += ' AND t.trip_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
      else if (startDate) { query += ' AND t.trip_date >= ?'; params.push(startDate); }
      else if (endDate) { query += ' AND t.trip_date <= ?'; params.push(endDate); }
      query += ' ORDER BY t.trip_date DESC';

      const rows = db.prepare(query).all(...params);
      csvContent += 'ID;Date;Chauffeur;Camion;Trajet;Montant (FCFA);Marchandise;Notes\n';
      for (const r of rows) {
        csvContent += [
          r.id,
          r.trip_date,
          sanitizeCsv(r.driver_name),
          r.truck_id,
          sanitizeCsv(r.route),
          r.amount_fcfa,
          sanitizeCsv(r.cargo || ''),
          sanitizeCsv(r.notes || '')
        ].join(';') + '\n';
      }
    } else if (type === 'fuel') {
      filename = `carburant_${nowStr}.csv`;
      let query = `
        SELECT f.*, d.name as driver_name 
        FROM fuel_expenses f 
        JOIN drivers d ON d.id = f.driver_id 
        WHERE 1=1
      `;
      const params = [];
      if (driver_id) { query += ' AND f.driver_id = ?'; params.push(driver_id); }
      if (truck_id) { query += ' AND f.truck_id = ?'; params.push(truck_id); }
      if (startDate && endDate) { query += ' AND f.expense_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
      else if (startDate) { query += ' AND f.expense_date >= ?'; params.push(startDate); }
      else if (endDate) { query += ' AND f.expense_date <= ?'; params.push(endDate); }
      query += ' ORDER BY f.expense_date DESC';

      const rows = db.prepare(query).all(...params);
      csvContent += 'ID;Date;Chauffeur;Camion;Litres;Montant (FCFA);Prix/Litre (FCFA);Station;Kilometrage;Notes\n';
      for (const r of rows) {
        const unitPrice = r.liters > 0 ? Math.round(r.amount_fcfa / r.liters) : 0;
        csvContent += [
          r.id,
          r.expense_date,
          sanitizeCsv(r.driver_name),
          r.truck_id,
          r.liters,
          r.amount_fcfa,
          unitPrice,
          sanitizeCsv(r.station),
          r.km_at_fill || '',
          sanitizeCsv(r.notes || '')
        ].join(';') + '\n';
      }
    } else if (type === 'maintenance') {
      filename = `entretiens_${nowStr}.csv`;
      let query = `
        SELECT m.*, d.name as driver_name 
        FROM maintenance_records m 
        LEFT JOIN drivers d ON d.id = m.driver_id 
        WHERE 1=1
      `;
      const params = [];
      if (truck_id) { query += ' AND m.truck_id = ?'; params.push(truck_id); }
      if (driver_id) { query += ' AND m.driver_id = ?'; params.push(driver_id); }
      if (service_type) { query += ' AND LOWER(m.service_type) = LOWER(?)'; params.push(service_type); }
      if (startDate && endDate) { query += ' AND m.record_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
      else if (startDate) { query += ' AND m.record_date >= ?'; params.push(startDate); }
      else if (endDate) { query += ' AND m.record_date <= ?'; params.push(endDate); }
      query += ' ORDER BY m.record_date DESC';

      const rows = db.prepare(query).all(...params);
      csvContent += 'ID;Date;Camion;Chauffeur;Type d\'intervention;Description;Montant (FCFA);Garage / Prestataire;Kilometrage\n';
      for (const r of rows) {
        csvContent += [
          r.id,
          r.record_date,
          r.truck_id,
          sanitizeCsv(r.driver_name || 'Non assigné'),
          sanitizeCsv(r.service_type),
          sanitizeCsv(r.description),
          r.amount_fcfa,
          sanitizeCsv(r.garage),
          r.km || ''
        ].join(';') + '\n';
      }
    } else if (type === 'expenses') {
      filename = `autres_depenses_${nowStr}.csv`;
      let query = `
        SELECT e.*, d.name as driver_name 
        FROM other_expenses e 
        LEFT JOIN drivers d ON d.id = e.driver_id 
        WHERE 1=1
      `;
      const params = [];
      if (driver_id) { query += ' AND e.driver_id = ?'; params.push(driver_id); }
      if (truck_id) { query += ' AND e.truck_id = ?'; params.push(truck_id); }
      if (startDate && endDate) { query += ' AND e.expense_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
      else if (startDate) { query += ' AND e.expense_date >= ?'; params.push(startDate); }
      else if (endDate) { query += ' AND e.expense_date <= ?'; params.push(endDate); }
      query += ' ORDER BY e.expense_date DESC';

      const rows = db.prepare(query).all(...params);
      csvContent += 'ID;Date;Chauffeur;Camion;Categorie;Description;Montant (FCFA);Notes\n';
      for (const r of rows) {
        csvContent += [
          r.id,
          r.expense_date,
          sanitizeCsv(r.driver_name || 'Non assigné'),
          r.truck_id || '',
          sanitizeCsv(r.category),
          sanitizeCsv(r.description),
          r.amount_fcfa,
          sanitizeCsv(r.notes || '')
        ].join(';') + '\n';
      }
    } else if (type === 'driver_account') {
      if (!driver_id) {
        return res.status(400).send('ID chauffeur manquant');
      }
      const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id);
      filename = `compte_chauffeur_${sanitizeCsv(driver?.name || driver_id)}_${nowStr}.csv`;

      // Récupération voyages, carburant, entretien et autres dépenses
      let dTripWhere = 'WHERE driver_id = ?';
      let dFuelWhere = 'WHERE driver_id = ?';
      let dMaintWhere = driver.assigned_truck ? 'WHERE (driver_id = ? OR truck_id = ?)' : 'WHERE driver_id = ?';
      let dExpenseWhere = driver.assigned_truck ? 'WHERE (driver_id = ? OR truck_id = ?)' : 'WHERE driver_id = ?';
      const dTripParams = [driver_id];
      const dFuelParams = [driver_id];
      const dMaintParams = driver.assigned_truck ? [driver_id, driver.assigned_truck] : [driver_id];
      const dExpenseParams = driver.assigned_truck ? [driver_id, driver.assigned_truck] : [driver_id];

      if (startDate && endDate) {
        dTripWhere += ' AND trip_date BETWEEN ? AND ?'; dTripParams.push(startDate, endDate);
        dFuelWhere += ' AND expense_date BETWEEN ? AND ?'; dFuelParams.push(startDate, endDate);
        dMaintWhere += ' AND record_date BETWEEN ? AND ?'; dMaintParams.push(startDate, endDate);
        dExpenseWhere += ' AND expense_date BETWEEN ? AND ?'; dExpenseParams.push(startDate, endDate);
      }

      const trips = db.prepare(`SELECT 'Voyage' as cat, trip_date as date, truck_id, route as desc, amount_fcfa as credit, 0 as debit FROM trips ${dTripWhere}`).all(...dTripParams);
      const fuel = db.prepare(`SELECT 'Carburant' as cat, expense_date as date, truck_id, (station || ' (' || liters || 'L)') as desc, 0 as credit, amount_fcfa as debit FROM fuel_expenses ${dFuelWhere}`).all(...dFuelParams);
      const maint = db.prepare(`SELECT ('Entretien (' || service_type || ')') as cat, record_date as date, truck_id, description as desc, 0 as credit, amount_fcfa as debit FROM maintenance_records ${dMaintWhere}`).all(...dMaintParams);
      const expenses = db.prepare(`SELECT ('Depense (' || category || ')') as cat, expense_date as date, truck_id, description as desc, 0 as credit, amount_fcfa as debit FROM other_expenses ${dExpenseWhere}`).all(...dExpenseParams);

      const allOps = [...trips, ...fuel, ...maint, ...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      csvContent += `Relevé de compte du chauffeur: ${sanitizeCsv(driver?.name)};Camion: ${driver?.assigned_truck || 'N/A'};Statut: ${driver?.is_contractor ? 'Sous-traitant' : 'Salarié'}\n`;
      csvContent += `Période: ${startDate || 'Origine'} au ${endDate || 'Ce jour'}\n\n`;
      csvContent += 'Date;Categorie;Camion;Description;Recette / Credit (FCFA);Depense / Debit (FCFA)\n';

      let totalCredit = 0;
      let totalDebit = 0;
      for (const op of allOps) {
        totalCredit += Number(op.credit || 0);
        totalDebit += Number(op.debit || 0);
        csvContent += [
          op.date,
          sanitizeCsv(op.cat),
          op.truck_id,
          sanitizeCsv(op.desc),
          op.credit || 0,
          op.debit || 0
        ].join(';') + '\n';
      }

      csvContent += `\nTOTAL RECETTES (FCFA);;;;${totalCredit};\n`;
      csvContent += `TOTAL CHARGES (FCFA);;;;;${totalDebit}\n`;
      csvContent += `SOLDE NET (FCFA);;;;${totalCredit - totalDebit};\n`;
    } else {
      return res.status(400).send('Type d\'export non supporté');
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Erreur export CSV:', err);
    res.status(500).send('Erreur lors de l\'export CSV.');
  }
});
