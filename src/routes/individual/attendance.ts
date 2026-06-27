import { Router } from 'express';
import { individualRequired } from '../../middleware/auth.js';
import {
  getIndividualParticipant,
  listIndividualParticipants,
  migrateIndividualRecords,
} from '../../services/individualPortalService.js';

const router = Router();

router.get('/', individualRequired, async (req, res) => {
  try {
    await migrateIndividualRecords(req.user!.id, req.user!.email);
    const records = await listIndividualParticipants(req.user!.id, req.user!.email);
    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
});

export default router;
