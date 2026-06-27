import { Router } from 'express';
import { query } from '../../db/pool.js';

const router = Router();

router.get('/stats', async (req, res) => {
  try {
    const isCoordinator = req.user?.role === 'coordinator';
    const coordinatorId = req.user?.id;

    const [workshops] = await query<{ count: number }>(`SELECT COUNT(*) as count FROM workshops`);
    
    let trainersCountSql = `SELECT COUNT(*) as count FROM trainers`;
    let trainersParams: unknown[] = [];
    if (isCoordinator) {
      trainersCountSql = `SELECT COUNT(*) as count FROM banks WHERE created_by = ?`;
      trainersParams = [coordinatorId];
    }
    const [trainers] = await query<{ count: number }>(trainersCountSql, trainersParams);

    let regCountSql = `SELECT COUNT(*) as count FROM registrations`;
    let regParams: unknown[] = [];
    if (isCoordinator) {
      regCountSql += ` WHERE created_by = ? OR email IN (SELECT email FROM users WHERE created_by = ?)`;
      regParams.push(coordinatorId, coordinatorId);
    }
    const [registrations] = await query<{ count: number }>(regCountSql, regParams);

    const [courses] = await query<{ count: number }>(`SELECT COUNT(*) as count FROM elearning_courses`);
    const [elearners] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM users WHERE role = 'elearner'`
    );
    const [enrollments] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM elearning_enrollments`
    );
    const [messages] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM contact_messages WHERE is_read = 0`
    );

    let revSql = `SELECT COALESCE(SUM(total_amount), 0) as total FROM registrations WHERE status != 'cancelled'`;
    let revParams: unknown[] = [];
    if (isCoordinator) {
      revSql += ` AND (created_by = ? OR email IN (SELECT email FROM users WHERE created_by = ?))`;
      revParams.push(coordinatorId, coordinatorId);
    }
    const [revenue] = await query<{ total: number }>(revSql, revParams);

    let recentSql = `
      SELECT r.id, r.full_name, r.email, r.registration_type, r.created_at, w.title as workshop_title
      FROM registrations r JOIN workshops w ON w.id = r.workshop_id
    `;
    let recentParams: unknown[] = [];
    if (isCoordinator) {
      recentSql += ` WHERE r.created_by = ? OR r.email IN (SELECT email FROM users WHERE created_by = ?)`;
      recentParams.push(coordinatorId, coordinatorId);
    }
    recentSql += ` ORDER BY r.created_at DESC LIMIT 50`;
    const recentRegs = await query(recentSql, recentParams);

    res.json({
      workshops: workshops.count,
      trainers: trainers.count,
      registrations: registrations.count,
      courses: courses.count,
      elearners: elearners.count,
      elearningEnrollments: enrollments.count,
      unreadMessages: messages.count,
      totalRevenue: revenue.total,
      recentRegistrations: recentRegs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
