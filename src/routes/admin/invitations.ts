import { Router } from 'express';
import { previewInvitation, sendWorkshopInvitations } from '../../services/invitationService.js';

const router = Router();

router.get('/preview/:workshopId', async (req, res) => {
  try {
    const workshopId = parseInt(req.params.workshopId, 10);
    const participantName = typeof req.query.name === 'string' ? req.query.name : undefined;
    const html = await previewInvitation(workshopId, participantName);

    if (!html) {
      return res.status(404).json({ error: 'Workshop not found' });
    }

    res.type('html').send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { workshop_id, participant_ids } = req.body;
    if (!workshop_id) {
      return res.status(400).json({ error: 'workshop_id is required' });
    }

    const ids = Array.isArray(participant_ids)
      ? participant_ids.map((id: unknown) => parseInt(String(id), 10)).filter((id) => !Number.isNaN(id))
      : undefined;

    const result = await sendWorkshopInvitations(parseInt(String(workshop_id), 10), ids);
    res.json(result);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Failed to send invitations';
    res.status(500).json({ error: message });
  }
});

export default router;
