import { Router, Request } from 'express';
import { individualRequired } from '../../middleware/auth.js';
import {
  generateCertificatePdf,
  previewCertificate,
} from '../../services/certificateService.js';
import {
  getIndividualParticipant,
  listIndividualParticipants,
  migrateIndividualRecords,
} from '../../services/individualPortalService.js';

const router = Router();

function assetsBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/api/certificate-assets`;
}

router.get('/', individualRequired, async (req, res) => {
  try {
    await migrateIndividualRecords(req.user!.id, req.user!.email);
    const records = await listIndividualParticipants(req.user!.id, req.user!.email);
    const certificates = records
      .filter((p) => p.attendance_status === 'present' || p.attended === 1)
      .map((p) => ({
        participant_id: p.id,
        workshop_id: p.workshop_id,
        workshop_title: p.workshop_title,
        start_date: p.start_date,
        end_date: p.end_date,
        full_name: p.full_name,
        certificate_sent: p.certificate_sent === 1,
        attendance_status: p.attendance_status,
      }));
    res.json(certificates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

router.get('/:participantId/pdf', individualRequired, async (req, res) => {
  try {
    const participantId = parseInt(req.params.participantId, 10);
    if (!Number.isFinite(participantId)) {
      return res.status(400).json({ error: 'Invalid certificate id' });
    }

    await migrateIndividualRecords(req.user!.id, req.user!.email);

    const participant = await getIndividualParticipant(
      participantId,
      req.user!.id,
      req.user!.email
    ) as {
      workshop_id: number;
      full_name: string;
      attendance_status: string | null;
      attended: number;
    } | null;

    if (!participant) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const isPresent =
      participant.attendance_status === 'present' || participant.attended === 1;
    if (!isPresent) {
      return res.status(403).json({ error: 'Certificate available only after attendance is marked present' });
    }

    const result = await generateCertificatePdf(
      participant.workshop_id,
      participant.full_name,
      assetsBaseUrl(req)
    );

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

router.get('/:participantId/preview', individualRequired, async (req, res) => {
  try {
    const participantId = parseInt(req.params.participantId, 10);
    if (!Number.isFinite(participantId)) {
      return res.status(400).json({ error: 'Invalid certificate id' });
    }

    await migrateIndividualRecords(req.user!.id, req.user!.email);

    const participant = await getIndividualParticipant(
      participantId,
      req.user!.id,
      req.user!.email
    ) as {
      workshop_id: number;
      full_name: string;
      attendance_status: string | null;
      attended: number;
    } | null;

    if (!participant) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const isPresent =
      participant.attendance_status === 'present' || participant.attended === 1;
    if (!isPresent) {
      return res.status(403).json({ error: 'Certificate available only after attendance is marked present' });
    }

    const html = await previewCertificate(
      participant.workshop_id,
      participant.full_name,
      assetsBaseUrl(req)
    );

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

export default router;
