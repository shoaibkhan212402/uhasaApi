import { Router } from 'express';
import { pool, query } from '../../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const rows = await query<{ setting_key: string; setting_value: string }>(
      `SELECT setting_key, setting_value FROM site_settings`
    );
    res.json(Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/', async (req, res) => {
  try {
    const settings = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(settings)) {
      await pool.execute(
        `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value]
      );
    }
    res.json({ message: 'Settings updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
