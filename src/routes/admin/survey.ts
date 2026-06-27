import { Router } from 'express';
import { pool, query, queryOne } from '../../db/pool.js';
import { sendEmail, surveyEmailHtml } from '../../services/emailService.js';

const router = Router();

router.post('/send', async (req, res) => {
  try {
    const { workshop_id, survey_url } = req.body;
    if (!workshop_id) {
      return res.status(400).json({ error: 'workshop_id required' });
    }

    const workshop = await queryOne<{ post_assessment_url: string | null }>(
      `SELECT post_assessment_url FROM workshops WHERE id = ?`,
      [workshop_id]
    );
    if (!workshop) {
      return res.status(404).json({ error: 'Workshop not found' });
    }

    const resolvedSurveyUrl = (survey_url || workshop.post_assessment_url || '').trim();
    if (!resolvedSurveyUrl) {
      return res.status(400).json({
        error: 'No survey URL configured. Set the post-assessment URL on the workshop or provide survey_url.',
      });
    }

    await pool.execute(
      `UPDATE workshops SET post_assessment_url = ? WHERE id = ?`,
      [resolvedSurveyUrl, workshop_id]
    );

    const participants = await query<{
      id: number;
      full_name: string;
      email: string;
      workshop_title: string;
    }>(
      `SELECT p.id, p.full_name, p.email, w.title as workshop_title
       FROM participants p
       JOIN workshops w ON w.id = p.workshop_id
       WHERE p.workshop_id = ? AND p.status = 'confirmed'`,
      [workshop_id]
    );

    let sent = 0;
    let failed = 0;

    for (const p of participants) {
      const ok = await sendEmail({
        to: p.email,
        subject: `Survey — ${p.workshop_title}`,
        html: surveyEmailHtml({
          participantName: p.full_name,
          workshopTitle: p.workshop_title,
          surveyUrl: resolvedSurveyUrl,
        }),
        templateType: 'survey',
        participantId: p.id,
      });
      if (ok) sent++;
      else failed++;
    }

    res.json({ sent, failed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send survey links' });
  }
});

export default router;
