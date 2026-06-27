import mysql from 'mysql2/promise';
import { config } from '../config.js';

const mediaBase = config.ftp.publicUrl || 'https://ahwuae.com/uasatrainingftp/uasatrainingftp';

const trainers = [
  {
    name: 'Yasin Arafat',
    title: 'Chief Operation Officer (COO) at Emirates Coin Investment',
    image_url: `${mediaBase}/uploads/trainer-yasin-arafat.jpg`,
    bio: 'Chief Operation Officer at Emirates Coin Investment with extensive experience in financial operations and capital markets.',
    expertise: ['Operations', 'Capital Markets', 'Investment'],
  },
  {
    name: 'Mohamed Ashraf',
    title: 'Technical Analysis Director for Commercial International Brokerage Company (CIBC)',
    image_url: `${mediaBase}/uploads/trainer-mohamed-ashraf.jpg`,
    bio: 'Technical Analysis Director at CIBC, specializing in market analysis and trading strategies.',
    expertise: ['Technical Analysis', 'Trading', 'Capital Markets'],
  },
  {
    name: 'Dr. Hesham Afifi',
    title: 'Executive',
    image_url: `${mediaBase}/uploads/trainer-hesham-afifi.jpg`,
    bio: 'Executive leader with deep expertise across financial services and regulatory environments.',
    expertise: ['Executive Leadership', 'Financial Services', 'Strategy'],
  },
  {
    name: 'Hisham Shalaby',
    title: 'Chartered MCSI, FMVA',
    image_url: `${mediaBase}/uploads/trainer-hisham-shalaby.jpg`,
    bio: 'Chartered MCSI and FMVA professional with expertise in financial modeling and investment analysis.',
    expertise: ['Financial Modeling', 'Investment Analysis', 'MCSI', 'FMVA'],
  },
  {
    name: 'Hala Abou Alwan',
    title: 'Lawyer, Financial Crimes & Cyber Crimes Expert, and Media Personality',
    image_url: `${mediaBase}/uploads/trainer-hala-abou-alwan.jpg`,
    bio: 'Lawyer and expert in financial crimes and cyber crimes, recognized media personality in compliance and legal affairs.',
    expertise: ['Financial Crime', 'Cyber Crime', 'Legal Compliance', 'Media'],
  },
];

async function updateTrainers() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  await connection.query('DELETE FROM trainers');
  await connection.query('ALTER TABLE trainers AUTO_INCREMENT = 1');
  for (const [index, trainer] of trainers.entries()) {
    await connection.query(
      `INSERT INTO trainers (name, title, image_url, bio, expertise, is_published, sort_order)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [
        trainer.name,
        trainer.title,
        trainer.image_url,
        trainer.bio,
        JSON.stringify(trainer.expertise),
        index,
      ]
    );
  }

  const [rows] = await connection.query('SELECT id, name, title, sort_order FROM trainers ORDER BY sort_order, id');
  console.log('Trainers updated:');
  console.table(rows);

  await connection.end();
}

updateTrainers().catch((err) => {
  console.error('Failed to update trainers:', err);
  process.exit(1);
});
