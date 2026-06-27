import { Router, Request } from 'express';
import { portalRequired } from '../../middleware/auth.js';
import { generateCertificatePdf, previewCertificate, sendWorkshopCertificates } from '../../services/certificateService.js';

const router = Router();

function assetsBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/api/certificate-assets`;
}

router.get('/preview/:workshopId/pdf', portalRequired, async (req, res) => {
  try {
    const workshopId = parseInt(req.params.workshopId, 10);
    const participantName = typeof req.query.name === 'string' ? req.query.name : undefined;
    const result = await generateCertificatePdf(workshopId, participantName, assetsBaseUrl(req));

    if (!result) {
      return res.status(404).json({ error: 'Workshop not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.pdf);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Failed to generate PDF';
    res.status(500).json({ error: message });
  }
});

router.get('/preview/:workshopId', portalRequired, async (req, res) => {
  try {
    const workshopId = parseInt(req.params.workshopId, 10);
    const participantName = typeof req.query.name === 'string' ? req.query.name : undefined;
    const html = await previewCertificate(workshopId, participantName, assetsBaseUrl(req));

    if (!html) {
      return res.status(404).json({ error: 'Workshop not found' });
    }

    res.type('html').send(html);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Failed to generate preview';
    res.status(500).json({ error: message });
  }
});

router.post('/send', portalRequired, async (req, res) => {
  try {
    const { workshop_id, participant_ids } = req.body;
    if (!workshop_id) {
      return res.status(400).json({ error: 'workshop_id is required' });
    }

    const ids = Array.isArray(participant_ids)
      ? participant_ids.map((id: unknown) => parseInt(String(id), 10)).filter((id) => !Number.isNaN(id))
      : undefined;

    const result = await sendWorkshopCertificates(
      parseInt(String(workshop_id), 10),
      ids,
      { userId: req.user!.id, assetsBaseUrl: assetsBaseUrl(req) }
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Failed to send certificates';
    res.status(500).json({ error: message });
  }
});

export default router;
