import { Router } from 'express';
import {
  addWorkshopMenuMonth,
  addWorkshopMenuYear,
  getWorkshopMenu,
} from '../../services/workshopMenuService.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await getWorkshopMenu());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshop menu' });
  }
});

router.post('/years', async (req, res) => {
  try {
    const year = parseInt(String(req.body?.year), 10);
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Enter a valid year' });
    }
    res.status(201).json(await addWorkshopMenuYear(year));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add year' });
  }
});

router.post('/months', async (req, res) => {
  try {
    const year = parseInt(String(req.body?.year), 10);
    const month = String(req.body?.month || '').trim();
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Select a valid year first' });
    }
    if (!month) {
      return res.status(400).json({ error: 'Enter a month name' });
    }
    res.status(201).json(await addWorkshopMenuMonth(year, month));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add month' });
  }
});

export default router;
