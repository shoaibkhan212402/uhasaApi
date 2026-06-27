import { Router } from 'express';
import { fulfillIndividualRegistration } from '../../services/individualRegistrationService.js';
import { createRegistration } from '../../services/registrationService.js';

const router = Router();

async function afterRegistrationCreated(
  registrationId: number,
  registrationType: unknown
) {
  if (registrationType !== 'Individual') return;

  try {
    await fulfillIndividualRegistration(registrationId);
  } catch (err) {
    console.error(`Individual registration fulfillment failed for id ${registrationId}:`, err);
  }
}

router.post('/', async (req, res) => {
  try {
    const body = req.body;

    // Batch insert (cart checkout without payment — legacy / admin use)
    if (Array.isArray(body.registrations)) {
      const ids: number[] = [];
      for (const reg of body.registrations) {
        const id = await createRegistration(reg);
        ids.push(id);
        if (!body.await_payment) {
          await afterRegistrationCreated(id, reg.registration_type);
        }
      }
      return res.status(201).json({ ids, message: 'Registration submitted successfully' });
    }

    const id = await createRegistration(body);
    if (!body.await_payment) {
      await afterRegistrationCreated(id, body.registration_type);
    }
    res.status(201).json({ ids: [id], message: 'Registration submitted successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create registration';
    const status = message.includes('Not enough seats') || message.includes('not found') ? 400 : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

export default router;
