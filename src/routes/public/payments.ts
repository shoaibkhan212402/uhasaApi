import { Router, Request } from 'express';
import { authRequired } from '../../middleware/auth.js';
import {
  createPublicCartCheckout,
  createPortalBookingCheckout,
  createIndividualPortalCheckout,
  getPaymentStatus,
  handleTelrReturn,
  handleTelrWebhook,
} from '../../services/paymentService.js';
import { createRegistration, type CreateRegistrationInput } from '../../services/registrationService.js';
import type { PortalUser } from '../../services/participantService.js';
import { createPendingIndividualRegistration } from '../../services/individualRegistrationService.js';

const router = Router();

function toPortalUser(req: Request): PortalUser {
  const u = req.user!;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as PortalUser['role'],
    company: u.company || null,
    bank_id: u.bank_id || null,
  };
}

router.post('/cart-checkout', async (req, res) => {
  try {
    const { registrations, total_amount, customer_email } = req.body;

    if (!Array.isArray(registrations) || registrations.length === 0) {
      return res.status(400).json({ error: 'At least one registration is required' });
    }

    const email = String(customer_email || '').trim();
    if (!email) {
      return res.status(400).json({ error: 'Customer email is required' });
    }

    const registrationIds: number[] = [];
    for (const reg of registrations) {
      const id = await createRegistration(reg as CreateRegistrationInput);
      registrationIds.push(id);
    }

    res.status(201).json({ completed: true, registration_ids: registrationIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    const status =
      message.includes('seats') || message.includes('not found') || message.includes('not configured')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.post('/portal-checkout', authRequired, async (req, res) => {
  try {
    const { workshop_id, participants, payment_method, terms_accepted } = req.body;
    const workshopId = parseInt(String(workshop_id), 10);

    if (!Number.isFinite(workshopId) || workshopId <= 0) {
      return res.status(400).json({ error: 'Invalid workshop' });
    }

    if (!Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ error: 'At least one participant is required' });
    }

    if (payment_method !== 'bank_transfer') {
      return res.status(400).json({ error: 'Only bank transfer payment is supported' });
    }

    const result = await createPortalBookingCheckout(toPortalUser(req), {
      workshop_id: workshopId,
      participants,
      payment_method,
      terms_accepted: Boolean(terms_accepted),
    });

    if ('completed' in result) {
      return res.status(201).json({ completed: true, order: result.order });
    }

    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    const status =
      message.includes('terms') ||
      message.includes('participant') ||
      message.includes('limit') ||
      message.includes('seats') ||
      message.includes('not found') ||
      message.includes('already') ||
      message.includes('not configured')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.post('/individual-checkout', authRequired, async (req, res) => {
  try {
    const workshopId = parseInt(String(req.body.workshop_id), 10);
    if (!Number.isFinite(workshopId)) {
      return res.status(400).json({ error: 'Invalid workshop id' });
    }

    const { terms_accepted, phone, person_id, job_position, company } = req.body;

    const pending = await createPendingIndividualRegistration(
      req.user!.id,
      req.user!.email,
      req.user!.name,
      workshopId,
      {
        terms_accepted: !!terms_accepted,
        phone,
        person_id,
        job_position,
        company,
      }
    );

    if (pending.totalAmount <= 0) {
      await import('../../services/individualRegistrationService.js').then((m) =>
        m.fulfillIndividualRegistration(pending.registrationId)
      );
      return res.status(201).json({
        completed: true,
        message: `Successfully registered for "${pending.workshopTitle}"`,
        registration_id: pending.registrationId,
        workshop_id: workshopId,
      });
    }

    return res.status(201).json({
      completed: true,
      message: `Successfully registered for "${pending.workshopTitle}". Please transfer AED ${pending.totalAmount.toFixed(2)} to our bank account to confirm your registration.`,
      registration_id: pending.registrationId,
      workshop_id: workshopId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    const status =
      message.includes('already registered') ||
      message.includes('Not enough seats') ||
      message.includes('not found') ||
      message.includes('not open') ||
      message.includes('closed') ||
      message.includes('terms') ||
      message.includes('not configured')
        ? 400
        : 500;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.get('/status/:cartId', async (req, res) => {
  try {
    const status = await getPaymentStatus(req.params.cartId);
    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch payment status';
    res.status(message.includes('not found') ? 404 : 500).json({ error: message });
  }
});

router.get('/return/:cartId', async (req, res) => {
  try {
    const outcome = String(req.query.outcome || 'declined');
    const telrOrderRef =
      typeof req.query.order_ref === 'string'
        ? req.query.order_ref
        : typeof req.query.ref === 'string'
          ? req.query.ref
          : undefined;

    const redirectUrl = await handleTelrReturn(req.params.cartId, outcome, telrOrderRef);
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('Telr return handler error:', err);
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(302, `${frontend}/payment/result?status=failed`);
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    await handleTelrWebhook(body);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Telr webhook error:', err);
    const message = err instanceof Error ? err.message : 'Webhook failed';
    res.status(message.includes('signature') ? 403 : 500).send(message);
  }
});

export default router;
