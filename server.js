/**
 * Serveur Express principal pour l'application de gestion de flotte et comptabilité chauffeurs
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initDatabase } from './db.js';
import { cookieParserMiddleware, requireAuth, authController } from './auth.js';
import { driversRouter } from './routes/drivers.js';
import { trucksRouter } from './routes/trucks.js';
import { tripsRouter } from './routes/trips.js';
import { fuelRouter } from './routes/fuel.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportRouter } from './routes/export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialisation de la base de données et des tables
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares fondamentaux
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParserMiddleware);

// Endpoint de santé (Healthcheck pour Coolify / Docker / AI Studio)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Gestion Flotte & Chauffeurs'
  });
});

// Routes d'authentification publiques
app.post('/api/auth/login', authController.login);
app.post('/api/auth/logout', authController.logout);
app.get('/api/auth/me', authController.me);

// Routes d'API protégées par cookie de session HttpOnly
app.use('/api/drivers', requireAuth, driversRouter);
app.use('/api/trucks', requireAuth, trucksRouter);
app.use('/api/trips', requireAuth, tripsRouter);
app.use('/api/fuel', requireAuth, fuelRouter);
app.use('/api/maintenance', requireAuth, maintenanceRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/export', requireAuth, exportRouter);

// Service des fichiers statiques du frontend vanilla (HTML, CSS, JS)
const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));

// Fallback SPA vers index.html pour toutes les routes non-API
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint API introuvable.' });
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('Page introuvable');
});

// Écoute sur port 3000 et host 0.0.0.0 (requis par conteneur et Coolify)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Serveur] Flotte & Chauffeurs en écoute sur http://0.0.0.0:${PORT}`);
});
