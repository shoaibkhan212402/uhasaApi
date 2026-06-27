import { Router } from 'express';
import { individualRequired } from '../../middleware/auth.js';
import { getIndividualDashboardStats, migrateIndividualRecords } from '../../services/individualPortalService.js';

const router = Router();

router.get('/stats', individualRequired, async (req, res) => {
  try {
    await migrateIndividualRecords(req.user!.id, req.user!.email);
    const stats = await getIndividualDashboardStats(req.user!.id, req.user!.email);
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
