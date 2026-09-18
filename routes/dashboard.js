/**
 * Routes API pour les Statistiques et le Tableau de Bord Global de l'Entreprise
 */
import express from 'express';
import { db } from '../db.js';

export const dashboardRouter = express.Router();

dashboardRouter.get('/stats', (req, res) => {
  try {
    const { startDate, endDate, truck_id } = req.query;

    let tripWhere = 'WHERE 1=1';
    let fuelWhere = 'WHERE 1=1';
    let maintWhere = 'WHERE 1=1';
    const tripParams = [];
    const fuelParams = [];
    const maintParams = [];

    if (truck_id) {
      tripWhere += ' AND truck_id = ?';
      fuelWhere += ' AND truck_id = ?';
      maintWhere += ' AND truck_id = ?';
      tripParams.push(truck_id);
      fuelParams.push(truck_id);
      maintParams.push(truck_id);
    }

    if (startDate && endDate) {
      tripWhere += ' AND trip_date BETWEEN ? AND ?';
      fuelWhere += ' AND expense_date BETWEEN ? AND ?';
      maintWhere += ' AND record_date BETWEEN ? AND ?';
      tripParams.push(startDate, endDate);
      fuelParams.push(startDate, endDate);
      maintParams.push(startDate, endDate);
    } else if (startDate) {
      tripWhere += ' AND trip_date >= ?';
      fuelWhere += ' AND expense_date >= ?';
      maintWhere += ' AND record_date >= ?';
      tripParams.push(startDate);
      fuelParams.push(startDate);
      maintParams.push(startDate);
    } else if (endDate) {
      tripWhere += ' AND trip_date <= ?';
      fuelWhere += ' AND expense_date <= ?';
      maintWhere += ' AND record_date <= ?';
      tripParams.push(endDate);
      fuelParams.push(endDate);
      maintParams.push(endDate);
    }

    // 1. Totaux globaux
    const tripStats = db.prepare(`
      SELECT 
        COUNT(id) as count,
        COALESCE(SUM(amount_fcfa), 0) as total_revenue
      FROM trips ${tripWhere}
    `).get(...tripParams);

    const fuelStats = db.prepare(`
      SELECT 
        COUNT(id) as count,
        COALESCE(SUM(liters), 0) as total_liters,
        COALESCE(SUM(amount_fcfa), 0) as total_fuel
      FROM fuel_expenses ${fuelWhere}
    `).get(...fuelParams);

    const maintStats = db.prepare(`
      SELECT 
        COUNT(id) as count,
        COALESCE(SUM(amount_fcfa), 0) as total_maintenance
      FROM maintenance_records ${maintWhere}
    `).get(...maintParams);

    const totalRevenue = Number(tripStats.total_revenue || 0);
    const totalFuel = Number(fuelStats.total_fuel || 0);
    const totalLiters = Number(fuelStats.total_liters || 0);
    const totalMaintenance = Number(maintStats.total_maintenance || 0);
    const totalCosts = totalFuel + totalMaintenance;
    const netProfit = totalRevenue - totalCosts;
    const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0;

    // 2. Performance par camion
    const trucks = db.prepare('SELECT code, brand_model, license_plate, status FROM trucks ORDER BY code ASC').all();
    const truckComparison = trucks.map(truck => {
      const tTripWhere = tripWhere + (truck_id ? '' : ' AND truck_id = ?');
      const tTripParams = truck_id ? [...tripParams] : [...tripParams, truck.code];
      const rev = db.prepare(`SELECT COALESCE(SUM(amount_fcfa), 0) as val, COUNT(id) as cnt FROM trips ${tTripWhere}`).get(...tTripParams);

      const tFuelWhere = fuelWhere + (truck_id ? '' : ' AND truck_id = ?');
      const tFuelParams = truck_id ? [...fuelParams] : [...fuelParams, truck.code];
      const fuel = db.prepare(`SELECT COALESCE(SUM(amount_fcfa), 0) as val, COALESCE(SUM(liters), 0) as lit FROM fuel_expenses ${tFuelWhere}`).get(...tFuelParams);

      const tMaintWhere = maintWhere + (truck_id ? '' : ' AND truck_id = ?');
      const tMaintParams = truck_id ? [...maintParams] : [...maintParams, truck.code];
      const maint = db.prepare(`SELECT COALESCE(SUM(amount_fcfa), 0) as val, COUNT(id) as cnt FROM maintenance_records ${tMaintWhere}`).get(...tMaintParams);

      const rVal = Number(rev.val || 0);
      const fVal = Number(fuel.val || 0);
      const mVal = Number(maint.val || 0);
      const net = rVal - fVal - mVal;

      return {
        code: truck.code,
        model: truck.brand_model,
        plate: truck.license_plate,
        status: truck.status,
        revenue: rVal,
        tripsCount: rev.cnt,
        fuel: fVal,
        fuelLiters: fuel.lit,
        maintenance: mVal,
        maintenanceCount: maint.cnt,
        netProfit: net
      };
    });

    // 3. Répartition des entretiens par catégorie
    const maintenanceByCategory = db.prepare(`
      SELECT 
        service_type,
        COUNT(id) as count,
        COALESCE(SUM(amount_fcfa), 0) as total_fcfa
      FROM maintenance_records ${maintWhere}
      GROUP BY service_type
      ORDER BY total_fcfa DESC
    `).all(...maintParams);

    // 4. Évolution temporelle par mois (pour graphique comparatif bar/line)
    // On extrait les 6 derniers mois
    const monthlyData = db.prepare(`
      WITH months AS (
        SELECT DISTINCT strftime('%Y-%m', trip_date) as m FROM trips
        UNION
        SELECT DISTINCT strftime('%Y-%m', expense_date) as m FROM fuel_expenses
        UNION
        SELECT DISTINCT strftime('%Y-%m', record_date) as m FROM maintenance_records
      )
      SELECT m as month FROM months WHERE m IS NOT NULL ORDER BY m ASC LIMIT 12
    `).all();

    const timeline = monthlyData.map(row => {
      const m = row.month;
      const rev = db.prepare("SELECT COALESCE(SUM(amount_fcfa), 0) as val FROM trips WHERE strftime('%Y-%m', trip_date) = ?").get(m).val;
      const fuel = db.prepare("SELECT COALESCE(SUM(amount_fcfa), 0) as val FROM fuel_expenses WHERE strftime('%Y-%m', expense_date) = ?").get(m).val;
      const maint = db.prepare("SELECT COALESCE(SUM(amount_fcfa), 0) as val FROM maintenance_records WHERE strftime('%Y-%m', record_date) = ?").get(m).val;
      
      const r = Number(rev || 0);
      const f = Number(fuel || 0);
      const mt = Number(maint || 0);
      return {
        month: m,
        revenue: r,
        fuel: f,
        maintenance: mt,
        costs: f + mt,
        netProfit: r - (f + mt)
      };
    });

    // 5. Performance consolidée par chauffeur
    const drivers = db.prepare('SELECT id, name, assigned_truck, phone, is_contractor, is_active FROM drivers ORDER BY name ASC').all();
    const driverComparison = drivers.map(driver => {
      const dTripWhere = tripWhere + ' AND driver_id = ?';
      const dTripParams = [...tripParams, driver.id];
      const rev = db.prepare(`SELECT COALESCE(SUM(amount_fcfa), 0) as val, COUNT(id) as cnt FROM trips ${dTripWhere}`).get(...dTripParams);

      const dFuelWhere = fuelWhere + ' AND driver_id = ?';
      const dFuelParams = [...fuelParams, driver.id];
      const fuel = db.prepare(`SELECT COALESCE(SUM(amount_fcfa), 0) as val, COALESCE(SUM(liters), 0) as lit FROM fuel_expenses ${dFuelWhere}`).get(...dFuelParams);

      const dMaintWhere = maintWhere + ' AND driver_id = ?';
      const dMaintParams = [...maintParams, driver.id];
      const maint = db.prepare(`SELECT COALESCE(SUM(amount_fcfa), 0) as val, COUNT(id) as cnt FROM maintenance_records ${dMaintWhere}`).get(...dMaintParams);

      const rVal = Number(rev.val || 0);
      const fVal = Number(fuel.val || 0);
      const mVal = Number(maint.val || 0);
      const net = rVal - fVal - mVal;

      return {
        id: driver.id,
        name: driver.name,
        assigned_truck: driver.assigned_truck,
        phone: driver.phone,
        is_contractor: driver.is_contractor,
        is_active: driver.is_active,
        revenue: rVal,
        tripsCount: rev.cnt,
        fuel: fVal,
        fuelLiters: fuel.lit,
        maintenance: mVal,
        maintenanceCount: maint.cnt,
        netProfit: net
      };
    });

    // 6. Top trajets routiers
    const topRoutes = db.prepare(`
      SELECT 
        route,
        COUNT(id) as count,
        COALESCE(SUM(amount_fcfa), 0) as total_fcfa
      FROM trips ${tripWhere}
      GROUP BY route
      ORDER BY total_fcfa DESC
      LIMIT 8
    `).all(...tripParams);

    res.json({
      summary: {
        totalRevenue,
        totalFuel,
        totalLiters,
        totalMaintenance,
        totalCosts,
        netProfit,
        profitMargin,
        tripsCount: Number(tripStats.count || 0),
        fuelCount: Number(fuelStats.count || 0),
        maintenanceCount: Number(maintStats.count || 0)
      },
      truckComparison,
      driverComparison,
      maintenanceByCategory,
      monthlyTimeline: timeline,
      topRoutes
    });
  } catch (err) {
    console.error('Erreur get dashboard stats:', err);
    res.status(500).json({ error: 'Erreur lors du calcul des statistiques.' });
  }
});
