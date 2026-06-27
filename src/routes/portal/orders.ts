import { Router } from 'express';
import { query, queryOne } from '../../db/pool.js';
import { portalRequired } from '../../middleware/auth.js';
import { buildInvoiceData, invoiceDownloadHtml } from '../../services/invoiceService.js';
import { invoiceDataToPdf } from '../../services/invoicePdfService.js';

const router = Router();

router.get('/', portalRequired, async (req, res) => {
  try {
    const orders = await query(
      `SELECT
         p.id AS participant_id,
         p.full_name,
         p.email,
         p.phone,
         p.person_id,
         p.job_position,
         p.status AS participant_status,
         p.attended,
         p.created_at,
         p.workshop_id,
         w.title AS workshop_title,
         w.start_date,
         w.time_slot,
         i.id AS invoice_id,
         i.invoice_number,
         i.total_amount,
         i.status AS invoice_status
       FROM participants p
       JOIN workshops w ON w.id = p.workshop_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [req.user!.id]
    );
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/:participantId/invoice', portalRequired, async (req, res) => {
  try {
    const participantId = parseInt(req.params.participantId, 10);
    if (!Number.isFinite(participantId)) {
      return res.status(400).json({ error: 'Invalid order id' });
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
      user_company: string | null;
      user_name: string;
      user_role: string;
      bank_name: string | null;
      company_address: string | null;
      company_trn: string | null;
      participant_count: number;
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
         u.company AS user_company,
         u.name AS user_name,
         u.role AS user_role,
         b.name AS bank_name,
         (
           SELECT r.company_address
           FROM registrations r
           WHERE (r.company = u.company OR r.email = u.email)
             AND r.company_address IS NOT NULL
             AND r.company_address != ''
           ORDER BY r.created_at DESC
           LIMIT 1
         ) AS company_address,
         (
           SELECT r.company_trn
           FROM registrations r
           WHERE (r.company = u.company OR r.email = u.email)
             AND r.company_trn IS NOT NULL
             AND r.company_trn != ''
           ORDER BY r.created_at DESC
           LIMIT 1
         ) AS company_trn,
         (
           SELECT COUNT(*)
           FROM participants p2
           WHERE p2.user_id = p.user_id
             AND p2.workshop_id = p.workshop_id
             AND p2.status != 'cancelled'
         ) AS participant_count
       FROM participants p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN banks b ON b.id = u.bank_id
       JOIN workshops w ON w.id = p.workshop_id
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.id = ? AND p.user_id = ?`,
      [participantId, req.user!.id]
    );

    if (!row) {
      return res.status(404).json({ error: 'Invoice not found for this order' });
    }

    const billedTo =
      row.user_role === 'bank'
        ? row.bank_name || row.user_company || row.user_name
        : row.user_company || row.user_name;

    const invoiceData = buildInvoiceData({
      invoiceNumber: row.invoice_number,
      createdAt: String(row.created_at),
      billedTo,
      billedAddress: row.company_address,
      billedTrn: row.company_trn,
      workshopTitle: row.workshop_title,
      workshopFormat: row.workshop_format,
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      participantCount: Number(row.participant_count) || 1,
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
