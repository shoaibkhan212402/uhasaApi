import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const DEMO_PASSWORD = 'Demo@123';
const force = process.argv.includes('--force');

async function tableCount(connection: mysql.Connection, table: string): Promise<number> {
  const [rows] = await connection.query(`SELECT COUNT(*) as c FROM ${table}`);
  return (rows as { c: number }[])[0]?.c ?? 0;
}

async function seed() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  const workshopCount = await tableCount(connection, 'workshops');
  if (workshopCount > 0 && !force) {
    console.log('Sample data already exists. Run with --force to re-seed workshops and related data.');
    await connection.end();
    return;
  }

  if (force && workshopCount > 0) {
    console.log('Clearing existing sample data...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('DELETE FROM email_log');
    await connection.query('DELETE FROM invoices');
    await connection.query('DELETE FROM participants');
    await connection.query('DELETE FROM registrations');
    await connection.query('DELETE FROM workshop_sections');
    await connection.query('DELETE FROM workshops');
    await connection.query('DELETE FROM trainers');
    await connection.query('DELETE FROM elearning_courses');
    await connection.query('DELETE FROM page_sections');
    await connection.query('DELETE FROM contact_messages');
    await connection.query('DELETE FROM media_files');
    await connection.query(
      `DELETE FROM users WHERE email NOT IN (?)`,
      [config.admin.email]
    );
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  const mediaBase = config.ftp.publicUrl || 'https://ahwuae.com/uasatrainingftp/uasatrainingftp';
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log('Seeding users...');
  await connection.query(
    `INSERT INTO users (email, password_hash, name, company, bank_id, role, is_active)
     VALUES
       (?, ?, 'Sarah Al Mansoori', 'Gulf Finance Holdings', NULL, 'corporate', 1),
       (?, ?, 'Ahmed Hassan', 'Emirates NBD Capital', 1, 'bank', 1),
       (?, ?, 'Fatima Al Zaabi', NULL, NULL, 'cto', 1),
       (?, ?, 'Omar Khalid', NULL, NULL, 'cma', 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [
      'corporate@demo.com', hash,
      'bank@demo.com', hash,
      'cto@demo.com', hash,
      'cma@demo.com', hash,
    ]
  );

  const [[{ corporateId }]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id as corporateId FROM users WHERE email = 'corporate@demo.com'`
  );
  const [[{ bankUserId }]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id as bankUserId FROM users WHERE email = 'bank@demo.com'`
  );
  const [[{ ctoId }]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id as ctoId FROM users WHERE email = 'cto@demo.com'`
  );
  const [[{ cmaId }]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id as cmaId FROM users WHERE email = 'cma@demo.com'`
  );

  console.log('Seeding workshops...');
  await connection.query(
    `INSERT INTO workshops
       (title, category, cpd_hours, start_date, end_date, time_slot, language, format,
        image_url, description, price, total_seats, cto_cma_limit, zoom_link, reminder_days_before, is_published)
     VALUES
       (?, 'AML / Cybersecurity / Securities Innovation', 8, '2026-07-15', '2026-07-16',
        '9:00 AM - 5:00 PM', 'English', 'Online',
        ?, ?, 1950.00, 30, 3, 'https://zoom.us/j/12345678901', 2, 1),
       (?, 'AML / Cybersecurity / Securities Innovation', 6, '2026-08-10', '2026-08-10',
        '10:00 AM - 4:00 PM', 'English', 'Hybrid',
        ?, ?, 1750.00, 25, 3, 'https://zoom.us/j/12345678902', 1, 1),
       (?, 'Other Topics', 4, '2026-09-05', '2026-09-05',
        '2:00 PM - 6:00 PM', 'Arabic', 'In-Person',
        ?, ?, 1500.00, 20, 2, NULL, 1, 1)`,
    [
      'AML Compliance Masterclass',
      `${mediaBase}/uploads/workshop-aml.jpg`,
      'A comprehensive two-day program covering UAE AML regulations, FATF recommendations, and practical compliance frameworks for financial institutions.',
      'Cybersecurity for Capital Markets',
      `${mediaBase}/uploads/workshop-cyber.jpg`,
      'Explore threat landscapes, incident response, and regulatory expectations for cybersecurity in securities and banking operations.',
      'Corporate Governance Essentials',
      `${mediaBase}/uploads/workshop-governance.jpg`,
      'Board responsibilities, disclosure requirements, and governance best practices aligned with SCA standards.',
    ]
  );

  const [workshopRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, title FROM workshops ORDER BY id`
  );

  const sectionTemplates = [
    { key: 'how_to_join', title: 'How to Join', content: '<p>Register through the portal or contact our training team. Payment confirms your seat.</p>' },
    { key: 'objectives', title: 'Objectives', content: '<ul><li>Understand regulatory requirements</li><li>Apply best practices in daily operations</li><li>Earn accredited CPD hours</li></ul>' },
    { key: 'target_audiences', title: 'Target Audiences', content: '<p>Compliance officers, risk managers, auditors, and financial services professionals.</p>' },
    { key: 'qualifications', title: 'Qualifications', content: '<p>Open to professionals with a background in finance, accounting, or law.</p>' },
    { key: 'agenda', title: 'Daily Agenda', content: '<p><strong>Day 1:</strong> Regulatory overview and case studies<br/><strong>Day 2:</strong> Practical workshops and assessment</p>' },
    { key: 'details', title: 'Details', content: '<p>Materials provided digitally. Certificate issued upon completion.</p>' },
  ];

  console.log('Seeding workshop sections...');
  for (const workshop of workshopRows) {
    for (const [i, section] of sectionTemplates.entries()) {
      await connection.query(
        `INSERT INTO workshop_sections (workshop_id, section_key, title, content, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content)`,
        [workshop.id, section.key, section.title, section.content, i]
      );
    }
  }

  console.log('Seeding trainers...');
  const trainers = [
    {
      name: 'Yasin Arafat',
      title: 'Chief Operation Officer (COO) at Emirates Coin Investment',
      image: `${mediaBase}/uploads/trainer-yasin-arafat.jpg`,
      bio: 'Chief Operation Officer at Emirates Coin Investment with extensive experience in financial operations and capital markets.',
      expertise: ['Operations', 'Capital Markets', 'Investment'],
    },
    {
      name: 'Mohamed Ashraf',
      title: 'Technical Analysis Director for Commercial International Brokerage Company (CIBC)',
      image: `${mediaBase}/uploads/trainer-mohamed-ashraf.jpg`,
      bio: 'Technical Analysis Director at CIBC, specializing in market analysis and trading strategies.',
      expertise: ['Technical Analysis', 'Trading', 'Capital Markets'],
    },
    {
      name: 'Dr. Hesham Afifi',
      title: 'Executive',
      image: `${mediaBase}/uploads/trainer-hesham-afifi.jpg`,
      bio: 'Executive leader with deep expertise across financial services and regulatory environments.',
      expertise: ['Executive Leadership', 'Financial Services', 'Strategy'],
    },
    {
      name: 'Hisham Shalaby',
      title: 'Chartered MCSI, FMVA',
      image: `${mediaBase}/uploads/trainer-hisham-shalaby.jpg`,
      bio: 'Chartered MCSI and FMVA professional with expertise in financial modeling and investment analysis.',
      expertise: ['Financial Modeling', 'Investment Analysis', 'MCSI', 'FMVA'],
    },
    {
      name: 'Hala Abou Alwan',
      title: 'Lawyer, Financial Crimes & Cyber Crimes Expert, and Media Personality',
      image: `${mediaBase}/uploads/trainer-hala-abou-alwan.jpg`,
      bio: 'Lawyer and expert in financial crimes and cyber crimes, recognized media personality in compliance and legal affairs.',
      expertise: ['Financial Crime', 'Cyber Crime', 'Legal Compliance', 'Media'],
    },
  ];
  for (const [index, trainer] of trainers.entries()) {
    await connection.query(
      `INSERT INTO trainers (name, title, image_url, bio, expertise, is_published, sort_order)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [trainer.name, trainer.title, trainer.image, trainer.bio, JSON.stringify(trainer.expertise), index]
    );
  }

  const workshop1Id = workshopRows[0]?.id;
  const workshop2Id = workshopRows[1]?.id;
  const workshop3Id = workshopRows[2]?.id;

  const [[{ adminId }]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id as adminId FROM users WHERE email = ?`,
    [config.admin.email]
  );

  console.log('Seeding registrations...');
  if (workshop1Id && workshop2Id) {
    await connection.query(
      `INSERT INTO registrations
         (workshop_id, registration_type, person_id, full_name, job_position, email, phone,
          company, total_seats, terms_accepted, total_amount, status)
       VALUES
         (?, 'Individual', 'EMP-1001', 'Layla Mohammed', 'Compliance Analyst',
          'layla.m@example.com', '+971501234567', NULL, 1, 1, 1950.00, 'confirmed'),
         (?, 'Corporate', NULL, 'Gulf Finance Holdings', NULL,
          'hr@gulffinance.ae', '+97142900556', 'Gulf Finance Holdings', 5, 1, 9750.00, 'confirmed'),
         (?, 'Bank', NULL, 'Emirates NBD Capital', 'Training Coordinator',
          'training@emiratesnbd.com', '+97142900557', 'Emirates NBD Capital Limited', 3, 1, 5250.00, 'pending')`,
      [workshop1Id, workshop1Id, workshop2Id]
    );
  }

  console.log('Seeding participants...');
  if (workshop1Id && workshop2Id && corporateId && bankUserId) {
    const participantRows = [
      [corporateId, workshop1Id, 'Sarah Al Mansoori', 'corporate@demo.com', '+971501111111', 'CMA-10001', 'HR Manager', 'confirmed', 1, 0, 1, 1],
      [corporateId, workshop1Id, 'Mohammed Ali', 'mohammed.ali@gulffinance.ae', '+971502222222', 'CMA-10002', 'Risk Officer', 'confirmed', 1, 0, 0, 0],
      [corporateId, workshop1Id, 'Layla Hassan', 'layla.hassan@gulffinance.ae', '+971507777001', 'CMA-10003', 'Compliance Analyst', 'confirmed', 1, 0, 0, 0],
      [corporateId, workshop2Id, 'Khalid Rahman', 'khalid.r@gulffinance.ae', '+971507777002', 'CMA-10004', 'Internal Auditor', 'confirmed', 1, 0, 0, 0],
      [corporateId, workshop2Id, 'Noor Al Suwaidi', 'noor.s@gulffinance.ae', '+971507777003', 'CMA-10005', 'Finance Manager', 'pending', 0, 0, 0, 0],
      [bankUserId, workshop2Id, 'Ahmed Hassan', 'bank@demo.com', '+971503333333', 'CMA-20001', 'Compliance Lead', 'confirmed', 1, 1, 1, 1],
      [bankUserId, workshop2Id, 'Aisha Rahman', 'aisha.r@bank.ae', '+971506666666', 'CMA-20002', 'AML Specialist', 'confirmed', 1, 0, 0, 0],
      [bankUserId, workshop1Id, 'Omar Farouk', 'omar.f@emiratesnbd.com', '+971508888001', 'CMA-20003', 'Training Coordinator', 'confirmed', 1, 0, 0, 0],
    ];

    if (ctoId) {
      participantRows.push(
        [ctoId, workshop1Id, 'Fatima Al Zaabi', 'cto@demo.com', '+971504444444', 'CMA-30001', 'Chief Technology Officer', 'confirmed', 0, 0, 0, 0],
        [ctoId, workshop2Id, 'Yousef Al Ketbi', 'yousef.k@hct.ac.ae', '+971509999001', 'CMA-30002', 'IT Director', 'confirmed', 0, 0, 0, 0],
      );
    }

    if (cmaId && workshop3Id) {
      participantRows.push(
        [cmaId, workshop3Id, 'Omar Khalid', 'cma@demo.com', '+971505555001', 'CMA-40001', 'Chartered Accountant', 'confirmed', 0, 0, 0, 0],
        [cmaId, workshop3Id, 'Mariam Al Shamsi', 'mariam.s@cma.ae', '+971505555002', 'CMA-40002', 'Audit Manager', 'confirmed', 0, 0, 0, 0],
      );
    }

    for (const row of participantRows) {
      await connection.query(
        `INSERT INTO participants
           (user_id, workshop_id, full_name, email, phone, person_id, job_position, status,
            confirmation_sent, reminder_sent, zoom_sent, attended)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row
      );
    }

    const [[{ participantId }]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id as participantId FROM participants WHERE email = 'corporate@demo.com' AND workshop_id = ?`,
      [workshop1Id]
    );

    console.log('Seeding invoices...');
    if (participantId) {
      await connection.query(
        `INSERT INTO invoices
           (invoice_number, user_id, workshop_id, participant_id, amount, vat_amount, total_amount, status, sent_at)
         VALUES
           ('INV-2026-0001', ?, ?, ?, 1950.00, 97.50, 2047.50, 'sent', NOW()),
           ('INV-2026-0002', ?, ?, ?, 1750.00, 87.50, 1837.50, 'paid', NOW())
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [corporateId, workshop1Id, participantId, bankUserId, workshop2Id, participantId]
      );

      await connection.query(
        `UPDATE participants SET invoice_id = (SELECT id FROM invoices WHERE invoice_number = 'INV-2026-0001' LIMIT 1)
         WHERE id = ?`,
        [participantId]
      );
    }

    const [[{ pId }]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id as pId FROM participants WHERE email = 'bank@demo.com' LIMIT 1`
    );

    console.log('Seeding email log...');
    await connection.query(
      `INSERT INTO email_log (recipient, subject, template_type, participant_id, status)
       VALUES
         ('corporate@demo.com', 'Workshop Registration Confirmed', 'confirmation', ?, 'sent'),
         ('bank@demo.com', 'Invoice INV-2026-0002', 'invoice', ?, 'sent'),
         ('cto@demo.com', 'Workshop Reminder - Cybersecurity', 'reminder', ?, 'sent'),
         ('invalid@example.com', 'Zoom Link - AML Masterclass', 'zoom', ?, 'failed')`,
      [participantId, pId, participantId, participantId]
    );
    await connection.query(
      `UPDATE email_log SET error_message = 'Mailbox not found' WHERE recipient = 'invalid@example.com'`
    );
  }

  console.log('Seeding e-learning courses...');
  await connection.query(
    `INSERT INTO elearning_courses
       (title, category, hours, lessons, level, image_url, video_url, pdf_url, description, is_published, sort_order)
     VALUES
       (?, 'Compliance', 3, 8, 'Beginner',
        ?, ?, ?, 'Introduction to UAE financial regulations and SCA licensing requirements.', 1, 0),
       (?, 'Risk Management', 5, 12, 'Intermediate',
        ?, ?, ?, 'Deep dive into operational risk frameworks for banking and capital markets.', 1, 1),
       (?, 'Technology', 4, 10, 'Advanced',
        ?, ?, ?, 'Blockchain, digital assets, and fintech regulation in the GCC region.', 1, 2)`,
    [
      'Introduction to Financial Regulation',
      `${mediaBase}/uploads/course-regulation.jpg`,
      `${mediaBase}/uploads/course-regulation.mp4`,
      `${mediaBase}/uploads/course-regulation.pdf`,
      'Operational Risk Management',
      `${mediaBase}/uploads/course-risk.jpg`,
      `${mediaBase}/uploads/course-risk.mp4`,
      `${mediaBase}/uploads/course-risk.pdf`,
      'Fintech & Digital Assets',
      `${mediaBase}/uploads/course-fintech.jpg`,
      `${mediaBase}/uploads/course-fintech.mp4`,
      `${mediaBase}/uploads/course-fintech.pdf`,
    ]
  );

  console.log('Seeding page sections...');
  const pageSections = [
    ['home', 'hero', 'Welcome to UASA Training', '<p>Structured CPD programs for financial services professionals across the UAE and GCC.</p>', 0],
    ['home', 'features', 'Why Choose Us', '<ul><li>SCA-aligned curriculum</li><li>Expert trainers</li><li>Flexible online and in-person formats</li></ul>', 1],
    ['about', 'main', 'About UASA Training', '<p>UASA Training delivers accredited continuing professional development for the capital markets and financial services sector.</p>', 0],
    ['about', 'mission', 'Our Mission', '<p>To raise professional standards through practical, regulation-focused training programs.</p>', 1],
    ['contact', 'intro', 'Get in Touch', '<p>Reach our team for workshop enquiries, corporate bookings, or technical support.</p>', 0],
    ['elearning', 'intro', 'E-Learning Platform', '<p>Self-paced courses with downloadable materials and verified CPD certificates.</p>', 0],
  ];
  for (const [slug, key, title, content, order] of pageSections) {
    await connection.query(
      `INSERT INTO page_sections (page_slug, section_key, title, content, sort_order, is_published)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content)`,
      [slug, key, title, content, order]
    );
  }

  console.log('Seeding contact messages...');
  await connection.query(
    `INSERT INTO contact_messages (name, email, phone, subject, message, is_read)
     VALUES
       ('John Smith', 'john.smith@company.ae', '+971505555555',
        'Corporate Training Enquiry', 'We would like to book 10 seats for the AML workshop in July.', 0),
       ('Aisha Rahman', 'aisha.r@bank.ae', '+971506666666',
        'Invoice Request', 'Please resend the invoice for our recent registration.', 1),
       ('David Chen', 'david.chen@fintech.io', NULL,
        'E-Learning Access', 'How do I access the self-paced courses after registration?', 0)`
  );

  console.log('Seeding media files...');
  if (adminId) {
    await connection.query(
      `INSERT INTO media_files
         (filename, original_name, file_type, mime_type, file_size, url, folder, uploaded_by)
       VALUES
         ('workshop-aml.jpg', 'AML Workshop Banner.jpg', 'image', 'image/jpeg', 245000,
          ?, 'uploads', ?),
         ('trainer-khalid.jpg', 'Dr Khalid Photo.jpg', 'image', 'image/jpeg', 180000,
          ?, 'uploads', ?),
         ('course-regulation.pdf', 'Regulation Course Guide.pdf', 'pdf', 'application/pdf', 520000,
          ?, 'uploads', ?)`,
      [
        `${mediaBase}/uploads/workshop-aml.jpg`, adminId,
        `${mediaBase}/uploads/trainer-khalid.jpg`, adminId,
        `${mediaBase}/uploads/course-regulation.pdf`, adminId,
      ]
    );
  }

  await connection.end();

  console.log('\nSample data seeded successfully.');
  console.log('\nDemo portal logins (password: Demo@123):');
  console.log('  corporate@demo.com  — Corporate user');
  console.log('  bank@demo.com       — Bank user');
  console.log('  cto@demo.com        — CTO user');
  console.log('  cma@demo.com        — CMA user');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
