import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { peekNextInvoiceNumber, reserveInvoiceNumbers } from '../../services/orderReference.js';

const router = Router();

const VAT_RATE = 0.05;

interface ManualInvoiceItem {
  participant_id: number;
  user_id: number;
  workshop_id: number;
  amount: number;
  notes?: string;
}

/**
 * GET /admin/manual-invoices/next-number
 * Returns a non-locking preview of the next invoice number.
 * The actual number assigned during generation may differ if other invoices
 * are created between the preview call and the final submission.
 */
router.get('/next-number', async (req, res) => {
  try {
    const preview = await peekNextInvoiceNumber();
    res.json(preview);
  } catch (err) {
    console.error('[manual-invoice] next-number error:', err);
    res.status(500).json({ error: 'Failed to fetch next invoice number' });
  }
});

/**
 * GET /admin/manual-invoices/participants
 * Search participants by name or email for the autocomplete.
 */
router.get('/participants', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    if (search.length < 2) {
      return res.json([]);
    }

    const like = `%${search}%`;
    const [rows] = await pool.execute(
      `SELECT
         p.id               AS participant_id,
         p.full_name,
         p.email,
         p.user_id,
         p.workshop_id,
         p.invoice_id,
         w.title            AS workshop_title,
         w.price            AS workshop_price,
         u.name             AS user_name,
         u.role             AS user_role,
         u.company          AS user_company
       FROM participants p
       JOIN users u        ON u.id = p.user_id
       LEFT JOIN workshops w ON w.id = p.workshop_id
       WHERE p.status != 'cancelled'
         AND p.invoice_id IS NULL
         AND (p.full_name LIKE ? OR p.email LIKE ? OR u.name LIKE ? OR u.email LIKE ?)
       ORDER BY p.created_at DESC
       LIMIT 30`,
      [like, like, like, like]
    );

    res.json(rows);
  } catch (err) {
    console.error('[manual-invoice] participants search error:', err);
    res.status(500).json({ error: 'Failed to search participants' });
  }
});

/**
 * POST /admin/manual-invoices/generate
 * Atomically generates invoices for one or more participants.
 *
 * Body:
 * {
 *   items: Array<{
 *     participant_id: number,
 *     user_id: number,
 *     workshop_id: number,
 *     amount: number,      // pre-tax amount
 *     notes?: string
 *   }>
 * }
 *
 * Transaction flow:
 *  1. Begin transaction
 *  2. SELECT MAX(seq) … FOR UPDATE  (blocks concurrent reservations)
 *  3. INSERT all invoices with consecutive numbers
 *  4. UPDATE participants SET invoice_id = …
 *  5. COMMIT
 *  6. Return created invoice_ids + numbers
 */
router.post('/generate', async (req, res) => {
  try {
    const { items, count } = req.body;

    let generateCount = 0;
    let isBlank = false;

    if (count !== undefined) {
      generateCount = parseInt(String(count), 10);
      if (!Number.isFinite(generateCount) || generateCount <= 0 || generateCount > 50) {
        return res.status(400).json({ error: 'count must be a positive integer between 1 and 50' });
      }
      isBlank = true;
    } else {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array or count is required and must not be empty' });
      }
      if (items.length > 50) {
        return res.status(400).json({ error: 'Cannot generate more than 50 invoices at once' });
      }
      // Validate each item
      for (const [i, item] of items.entries()) {
        if (!item.participant_id || !item.user_id || !item.workshop_id) {
          return res.status(400).json({ error: `Item ${i + 1}: participant_id, user_id, and workshop_id are required` });
        }
        if (typeof item.amount !== 'number' || item.amount < 0) {
          return res.status(400).json({ error: `Item ${i + 1}: amount must be a non-negative number` });
        }
      }
      generateCount = items.length;
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Step 1: Atomically reserve N sequential invoice numbers
      const invoiceNumbers = await reserveInvoiceNumbers(generateCount, conn);

      const createdInvoices: { invoice_number: string; invoice_id: number; participant_id: number | null }[] = [];

      // Step 2: Insert all invoices in order
      for (let i = 0; i < generateCount; i++) {
        const invoiceNumber = invoiceNumbers[i];
        let amount = 0;
        let vatAmount = 0;
        let totalAmount = 0;
        let userId = req.user!.id; // Fallback to current admin
        let workshopId = null;
        let participantId = null;

        if (!isBlank) {
          const item = items[i];
          amount = Math.round(item.amount * 100) / 100;
          vatAmount = Math.round(amount * VAT_RATE * 100) / 100;
          totalAmount = Math.round((amount + vatAmount) * 100) / 100;
          userId = item.user_id;
          workshopId = item.workshop_id;
          participantId = item.participant_id;
        }

        const [insertResult] = await conn.execute(
          `INSERT INTO invoices
             (invoice_number, user_id, workshop_id, participant_id, amount, vat_amount, total_amount, status, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', NULL)`,
          [invoiceNumber, userId, workshopId, participantId, amount, vatAmount, totalAmount]
        );

        const invoiceId = (insertResult as { insertId: number }).insertId;

        if (!isBlank && participantId) {
          // Link invoice to participant if not blank
          await conn.execute(
            `UPDATE participants SET invoice_id = ? WHERE id = ?`,
            [invoiceId, participantId]
          );
        }

        createdInvoices.push({
          invoice_number: invoiceNumber,
          invoice_id: invoiceId,
          participant_id: participantId,
        });
      }

      await conn.commit();

      res.json({
        message: `Successfully generated ${createdInvoices.length} invoice(s)`,
        invoices: createdInvoices,
        range: {
          from: invoiceNumbers[0],
          to: invoiceNumbers[invoiceNumbers.length - 1],
        },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[manual-invoice] generate error:', err);
    res.status(500).json({ error: 'Failed to generate invoices. Transaction rolled back.' });
  }
});

export default router;
