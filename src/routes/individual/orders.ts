import { Router } from 'express';
import { queryOne } from '../../db/pool.js';
import { individualRequired } from '../../middleware/auth.js';
import { buildInvoiceData, invoiceDownloadHtml } from '../../services/invoiceService.js';
import { invoiceDataToPdf } from '../../services/invoicePdfService.js';
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
    const orders = records.map((p) => ({
      participant_id: p.id,
      workshop_id: p.workshop_id,
      full_name: p.full_name,
      email: p.email,
      phone: p.phone,
      person_id: p.person_id,
      job_position: p.job_position,
      participant_status: p.status,
      attended: p.attended ? 1 : 0,
      attendance_status: p.attendance_status,
      created_at: p.created_at,
      workshop_title: p.workshop_title,
      start_date: p.start_date,
      end_date: p.end_date,
      time_slot: p.time_slot,
      invoice_id: p.invoice_id,
      invoice_number: p.invoice_number,
      total_amount: p.invoice_total,
      invoice_status: p.invoice_status,
    }));
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/:participantId/invoice', individualRequired, async (req, res) => {
  try {
    const participantId = parseInt(req.params.participantId, 10);
    if (!Number.isFinite(participantId)) {
      return res.status(400).json({ error: 'Invalid order id' });
    }

    await migrateIndividualRecords(req.user!.id, req.user!.email);

    const participant = await getIndividualParticipant(
      participantId,
      req.user!.id,
      req.user!.email
    );
    if (!participant || !participant.invoice_id) {
      return res.status(404).json({ error: 'Invoice not found for this order' });
    }

    const row = await queryOne<{
      invoice_id: number;
      invoice_number: string;
      invoice_status: string;
      created_at: string;
      workshop_id: number;
      workshop_title: string;
      workshop_format: string;
      start_date: string;
      end_date: string;
      workshop_price: number;
      participant_name: string;
      company_address: string | null;
      company_trn: string | null;
    }>(
      `SELECT
         i.id AS invoice_id,
         i.invoice_number,
         i.status AS invoice_status,
         i.created_at,
         p.workshop_id,
         w.title AS workshop_title,
         w.format AS workshop_format,
         w.start_date,
         w.end_date,
         w.price AS workshop_price,
         p.full_name AS participant_name,
         (
           SELECT r.company_address
           FROM registrations r
           WHERE LOWER(r.email) = LOWER(p.email)
             AND r.company_address IS NOT NULL
             AND r.company_address != ''
           ORDER BY r.created_at DESC
           LIMIT 1
         ) AS company_address,
         (
           SELECT r.company_trn
           FROM registrations r
           WHERE LOWER(r.email) = LOWER(p.email)
             AND r.company_trn IS NOT NULL
             AND r.company_trn != ''
           ORDER BY r.created_at DESC
           LIMIT 1
         ) AS company_trn
       FROM participants p
       JOIN workshops w ON w.id = p.workshop_id
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.id = ?`,
      [participantId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Invoice not found for this order' });
    }

    const invoiceData = buildInvoiceData({
      invoiceNumber: row.invoice_number,
      createdAt: String(row.created_at),
      billedTo: row.participant_name,
      billedAddress: row.company_address,
      billedTrn: row.company_trn,
      workshopTitle: row.workshop_title,
      workshopFormat: row.workshop_format,
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      participantCount: 1,
      unitPrice: Number(row.workshop_price),
    });

    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      const html = invoiceDownloadHtml(invoiceData);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${row.invoice_number}.html"`
      );
      return res.send(html);
    }

    const pdf = await invoiceDataToPdf(invoiceData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.invoice_number}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

export default router;
