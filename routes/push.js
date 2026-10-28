/**
 * v4.32 — Routes API : abonnement aux notifications (agent au port et bureau)
 */
import express from 'express';
import { vapidPublicKey, saveSubscription, removeSubscription, hasSubscription, notifyUser } from '../lib/push.js';

export const pushRouter = express.Router();

pushRouter.get('/vapid', (req, res) => res.json({ publicKey: vapidPublicKey() }));

pushRouter.get('/status', (req, res) => res.json({ subscribed: hasSubscription(req.user.username) }));

pushRouter.post('/subscribe', (req, res) => {
  try {
    saveSubscription(req.user, req.body?.subscription, req.headers['user-agent']);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

pushRouter.post('/unsubscribe', (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ success: true });
});

pushRouter.post('/test', async (req, res) => {
  const r = await notifyUser(req.user.username, {
    title: 'Notifications activées',
    body: 'Vous recevrez ici les messages du bureau YM-TRANSIT.',
    url: req.user.role === 'agent_port' ? '/port' : '/',
    tag: 'test'
  });
  if (!r.sent) return res.status(404).json({ error: "Aucun appareil abonné : réactivez les notifications." });
  res.json({ success: true, sent: r.sent });
});
