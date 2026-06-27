import { Router } from 'express';
import { query, queryOne } from '../../db/pool.js';
import {
  buildInvoiceListQuery,
  fetchInvoicesForExport,
  INVOICE_FROM,
  INVOICE_SELECT,
} from '../../services/invoiceQuery.js';
import {
  invoicesToCsv,
  invoicesToPdf,
  invoicesToXlsx,
  type InvoiceExportRow,
} from '../../services/invoiceExportService.js';

const router = Router();

router.get('/export', async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Invalid export format. Use csv, xlsx, or pdf.' });
    }

    const rows = (await fetchInvoicesForExport(req.query, req.user)) as InvoiceExportRow[];
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `invoices-${stamp}`;

    if (format === 'csv') {
      const csv = invoicesToCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send(`\uFEFF${csv}`);
    }

    if (format === 'xlsx') {
      const buffer = invoicesToXlsx(rows);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      return res.send(buffer);
    }

    const pdf = await invoicesToPdf(rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export invoices' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { sql, params } = buildInvoiceListQuery(req.query, req.user);
    const invoices = await query(sql, params);
    res.json(invoices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid invoice id' });
    }

    if (req.user?.role === 'coordinator') {
      const belongs = await queryOne<{ id: number }>(
        `SELECT i.id FROM invoices i
         JOIN users u ON u.id = i.user_id
         LEFT JOIN registrations reg_invoice ON reg_invoice.id = i.registration_id
         WHERE i.id = ? AND (u.created_by = ? OR reg_invoice.created_by = ?)`,
        [id, req.user.id, req.user.id]
      );
      if (!belongs) {
        return res.status(403).json({ error: 'Access denied: you did not create the associated partner/registration' });
      }
    }

    const invoice = await queryOne(
      `${INVOICE_SELECT} ${INVOICE_FROM} WHERE i.id = ?`,
      [id]
    );

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const row = invoice as {
      user_id: number;
      workshop_id: number | null;
      participant_id: number | null;
      registration_id: number | null;
    };

    let orderParticipants;
    if (row.registration_id) {
      orderParticipants = await query(
        `SELECT r.id,
                r.full_name,
                r.email,
                r.phone,
                r.person_id,
                r.job_position,
                r.status,
                i.invoice_number,
                i.total_amount AS invoice_total
         FROM registrations r
         LEFT JOIN invoices i ON i.registration_id = r.id
         WHERE r.id = ?`,
        [row.registration_id]
      );
    } else {
      orderParticipants = await query(
        `SELECT p.id,
                p.full_name,
                p.email,
                p.phone,
                p.person_id,
                p.job_position,
                p.status,
                i.invoice_number,
                i.total_amount AS invoice_total
         FROM participants p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.user_id = ?
           AND p.workshop_id = ?
           AND p.status != 'cancelled'
         ORDER BY p.created_at ASC`,
        [row.user_id, row.workshop_id]
      );
    }

    res.json({ ...invoice, order_participants: orderParticipants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch invoice details' });
  }
});

export default router;
