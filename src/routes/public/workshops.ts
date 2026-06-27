import { Router } from 'express';
import { query, queryOne } from '../../db/pool.js';
import { getWorkshopMenu } from '../../services/workshopMenuService.js';
import {
  listWorkshopSeatAvailability,
  publishedWorkshopsWithSeatsFrom,
  publishedWorkshopsWithSeatsSelect,
} from '../../services/workshopSeatsService.js';

const router = Router();

router.get('/menu', async (_req, res) => {
  try {
    res.json(await getWorkshopMenu());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshop menu' });
  }
});

router.get('/seat-availability', async (_req, res) => {
  try {
    res.json(await listWorkshopSeatAvailability());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshop seat availability' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const workshops = await query(
      `SELECT ${publishedWorkshopsWithSeatsSelect}
       FROM ${publishedWorkshopsWithSeatsFrom}
       WHERE w.is_published = 1 AND w.end_date >= CURDATE()
       ORDER BY w.start_date ASC`
    );
    res.json(workshops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshops' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const workshop = await queryOne(`SELECT * FROM workshops WHERE id = ? AND is_published = 1 AND end_date >= CURDATE()`, [id]);
    if (!workshop) return res.status(404).json({ error: 'Workshop not found' });

    const sections = await query(
      `SELECT section_key, title, content, sort_order FROM workshop_sections WHERE workshop_id = ? ORDER BY sort_order`,
      [id]
    );

    const seatRows = await query<{ total_seats: number | null }>(
      `SELECT total_seats FROM registrations WHERE workshop_id = ? AND status != 'cancelled'`,
      [id]
    );
    const portalSeats = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM participants WHERE workshop_id = ? AND status != 'cancelled'`,
      [id]
    );
    const registeredSeats =
      seatRows.reduce((sum, r) => sum + (r.total_seats || 1), 0) + (portalSeats?.count || 0);

    res.json({ ...workshop, sections, registeredSeats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workshop' });
  }
});

export default router;
