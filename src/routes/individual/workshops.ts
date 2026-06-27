import { Router } from 'express';
import { individualRequired } from '../../middleware/auth.js';
import {
  listAvailableWorkshopsForIndividual,
  listIndividualWorkshops,
  migrateIndividualRecords,
  getIndividualRegistrationDefaults,
} from '../../services/individualPortalService.js';
import { registerIndividualForWorkshop } from '../../services/individualRegistrationService.js';

const router = Router();

router.get('/available', individualRequired, async (req, res) => {
  try {
    await migrateIndividualRecords(req.user!.id, req.user!.email);
    const workshops = await listAvailableWorkshopsForIndividual(req.user!.id, req.user!.email);
    res.json(workshops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch available workshops' });
  }
});

router.get('/registration-defaults', individualRequired, async (req, res) => {
  try {
    await migrateIndividualRecords(req.user!.id, req.user!.email);
    const defaults = await getIndividualRegistrationDefaults(req.user!.id, req.user!.email);
    res.json(defaults || { phone: null, person_id: null, job_position: null, company: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch registration defaults' });
  }
});

router.post('/:workshopId/register', individualRequired, async (req, res) => {
  try {
    const workshopId = parseInt(req.params.workshopId, 10);
    if (!Number.isFinite(workshopId)) {
      return res.status(400).json({ error: 'Invalid workshop id' });
    }

    const { terms_accepted, phone, person_id, job_position, company } = req.body;
    const result = await registerIndividualForWorkshop(
      req.user!.id,
      req.user!.email,
      req.user!.name,
      workshopId,
      { terms_accepted: !!terms_accepted, phone, person_id, job_position, company }
    );

    res.status(201).json({
      message: `Successfully registered for "${result.workshopTitle}"`,
      registration_id: result.registrationId,
      workshop_id: workshopId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    const status =
      message.includes('already registered') ||
      message.includes('Not enough seats') ||
      message.includes('not found') ||
      message.includes('not open') ||
      message.includes('closed') ||
      message.includes('terms')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.get('/', individualRequired, async (req, res) => {
  try {
    await migrateIndividualRecords(req.user!.id, req.user!.email);
    const workshops = await listIndividualWorkshops(req.user!.id, req.user!.email);
    res.json(workshops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshops' });
  }
});

export default router;
