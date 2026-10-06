/**
 * Serveur Express principal pour l'application de gestion de flotte et comptabilité chauffeurs
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

import { initDatabase } from './db.js';
import { cookieParserMiddleware, requireAuth, authController } from './auth.js';
import { adminRouter } from './routes/admin.js';
import { driversRouter } from './routes/drivers.js';
import { trucksRouter } from './routes/trucks.js';
import { tripsRouter } from './routes/trips.js';
import { fuelRouter } from './routes/fuel.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { expensesRouter } from './routes/expenses.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportRouter } from './routes/export.js';
import { documentsRouter } from './routes/documents.js';
import { advancesRouter } from './routes/advances.js';
import { analyticsRouter } from './routes/analytics.js';
import { journalRouter } from './routes/journal.js';
import { subcontractorsRouter } from './routes/subcontractors.js';

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

// Routes admin (superadmin uniquement — rôle vérifié dans le routeur)
app.use('/api/admin', requireAuth, adminRouter);

// Routes d'API protégées par cookie de session HttpOnly
app.use('/api/drivers', requireAuth, driversRouter);
app.use('/api/trucks', requireAuth, trucksRouter);
app.use('/api/trips', requireAuth, tripsRouter);
app.use('/api/fuel', requireAuth, fuelRouter);
app.use('/api/maintenance', requireAuth, maintenanceRouter);
app.use('/api/expenses', requireAuth, expensesRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/advances', requireAuth, advancesRouter);
app.use('/api/analytics', requireAuth, analyticsRouter);
app.use('/api/journal',   requireAuth, journalRouter);
app.use('/api/subcontractors', requireAuth, subcontractorsRouter);

// === Upload de documents (PJ entretiens) ===
const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `doc_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Type de fichier non autorisé. Utilisez PDF, JPG ou PNG.'));
  }
});

app.post('/api/upload/document', requireAuth, upload.single('document'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Service des fichiers statiques du frontend vanilla (HTML, CSS, JS)
const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));

// Page d'administration (servie statiquement — l'auth est gérée côté client JS)
app.get('/admin', (req, res) => {
  const adminPath = path.join(publicDir, 'admin.html');
  if (fs.existsSync(adminPath)) {
    return res.sendFile(adminPath);
  }
  return res.status(404).send('Page admin introuvable');
});

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
