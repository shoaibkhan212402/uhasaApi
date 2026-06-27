import { Router } from 'express';
import { queryOne } from '../../db/pool.js';
import { portalRequired } from '../../middleware/auth.js';

const router = Router();

router.get('/stats', portalRequired, async (req, res) => {
  try {
    const userId = req.user!.id;

    const participants = await queryOne<{ total: number; attended: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN p.attendance_status = 'present' THEN 1 ELSE 0 END) AS attended
       FROM participants p
       WHERE p.user_id = ? AND p.status != 'cancelled'`,
      [userId]
    );

    const pendingOrderStats = await queryOne<{
      pending_orders: number;
      pending_orders_week: number;
    }>(
      `SELECT
         COUNT(*) AS pending_orders,
         SUM(CASE WHEN order_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS pending_orders_week
       FROM (
         SELECT
           p.workshop_id,
           MAX(p.created_at) AS order_date,
           MAX(
             CASE
               WHEN i.status = 'paid' THEN 0
               WHEN i.status IN ('draft', 'sent') THEN 1
               WHEN p.status = 'pending' THEN 1
               ELSE 0
             END
           ) AS is_pending
         FROM participants p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.user_id = ? AND p.status != 'cancelled'
         GROUP BY p.workshop_id
         HAVING is_pending = 1
       ) pending_workshop_orders`,
      [userId]
    );

    const weekStats = await queryOne<{ participants_week: number }>(
      `SELECT COUNT(*) AS participants_week
       FROM participants
       WHERE user_id = ? AND status != 'cancelled'
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
      [userId]
    );

    res.json({
      total_participants: Number(participants?.total) || 0,
      pending_orders: Number(pendingOrderStats?.pending_orders) || 0,
      total_attendance: Number(participants?.attended) || 0,
      participants_this_week: Number(weekStats?.participants_week) || 0,
      pending_orders_this_week: Number(pendingOrderStats?.pending_orders_week) || 0,
      attendance_today: 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
