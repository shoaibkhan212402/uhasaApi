import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { ensureElearnerSchema } from './db/ensureElearnerSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveCertificateAssetsDir(): string {
  const candidates = [
    path.join(__dirname, 'assets/certificates'),
    path.join(__dirname, '../src/assets/certificates'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}
import { adminRequired, authRequired } from './middleware/auth.js';

// Public routes
import publicWorkshops from './routes/public/workshops.js';
import publicTrainers from './routes/public/trainers.js';
import publicRegistrations from './routes/public/registrations.js';
import publicContact from './routes/public/contact.js';
import publicElearning from './routes/public/elearning.js';
import publicPages from './routes/public/pages.js';
import publicBanners from './routes/public/banners.js';
import publicAuth from './routes/public/auth.js';
import publicBanks from './routes/public/banks.js';
import publicPayments from './routes/public/payments.js';

// Portal routes
import portalAuth from './routes/portal/auth.js';
import portalParticipants from './routes/portal/participants.js';
import portalCertificates from './routes/portal/certificates.js';
import portalDashboard from './routes/portal/dashboard.js';
import portalOrders from './routes/portal/orders.js';
import portalWorkshops from './routes/portal/workshops.js';

// Individual portal routes
import individualAuth from './routes/individual/auth.js';
import individualDashboard from './routes/individual/dashboard.js';
import individualWorkshops from './routes/individual/workshops.js';
import individualAttendance from './routes/individual/attendance.js';
import individualOrders from './routes/individual/orders.js';
import individualCertificates from './routes/individual/certificates.js';

// E-Learning learner portal routes
import learnerAuth from './routes/learner/auth.js';
import learnerDashboard from './routes/learner/dashboard.js';
import learnerCourses from './routes/learner/courses.js';
import learnerCertificates from './routes/learner/certificates.js';
import learnerPlayer from './routes/learner/player.js';

// Admin routes
import adminWorkshops from './routes/admin/workshops.js';
import adminWorkshopMenu from './routes/admin/workshopMenu.js';
import adminTrainers from './routes/admin/trainers.js';
import adminRegistrations from './routes/admin/registrations.js';
import adminElearning from './routes/admin/elearning.js';
import adminPages from './routes/admin/pages.js';
import adminContact from './routes/admin/contact.js';
import adminMedia from './routes/admin/media.js';
import adminDashboard from './routes/admin/dashboard.js';
import adminUsers from './routes/admin/users.js';
import adminSettings from './routes/admin/settings.js';
import adminBanks from './routes/admin/banks.js';
import adminInvoices from './routes/admin/invoices.js';
import adminManualInvoice from './routes/admin/manualInvoice.js';
import adminParticipants from './routes/admin/participants.js';
import adminSurvey from './routes/admin/survey.js';
import adminInvitations from './routes/admin/invitations.js';
import adminCertificates from './routes/admin/certificates.js';
import adminBanners from './routes/admin/banners.js';
import adminImport from './routes/admin/import.js';
import adminAuth from './routes/admin/auth.js';
import adminElearnerUsers from './routes/admin/elearnerUsers.js';
import adminLmsStructure from './routes/admin/lmsStructure.js';

const app = express();

console.log(
  config.corsAllowAll
    ? 'CORS: allowing all origins'
    : `Allowed CORS Origins: ${config.corsOrigins.join(', ')}`
);

const corsOptions: cors.CorsOptions = {
  origin: config.corsAllowAll
    ? true
    : (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.error(`CORS Blocked: ${origin}`);
      return callback(null, false);
    },

  credentials: true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
  ],

  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'Content-Disposition',
  ],

  optionsSuccessStatus: 204,
};

// CORS must run before helmet and routes so preflight OPTIONS always gets headers
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  '/api/certificate-assets',
  express.static(resolveCertificateAssetsDir())
);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    corsOrigins: config.corsOrigins,
    corsAllowAll: config.corsAllowAll,
  });
});

// =========================
// PUBLIC API
// =========================
app.use('/api/workshops', publicWorkshops);
app.use('/api/trainers', publicTrainers);
app.use('/api/registrations', publicRegistrations);
app.use('/api/contact', publicContact);
app.use('/api/elearning', publicElearning);
app.use('/api/pages', publicPages);
app.use('/api/banners', publicBanners);
app.use('/api/auth', publicAuth);
app.use('/api/banks', publicBanks);
app.use('/api/payments/telr', publicPayments);

// =========================
// PORTAL API
// =========================
// Portal routes — mount workshops before the catch-all /api/portal auth router
app.use('/api/portal/workshops', authRequired, portalWorkshops);
app.use('/api/portal', authRequired, portalAuth);
app.use('/api/portal/dashboard', portalDashboard);
app.use('/api/portal/orders', portalOrders);
app.use('/api/portal/participants', portalParticipants);
app.use('/api/portal/certificates', portalCertificates);

// =========================
// INDIVIDUAL PORTAL API
// =========================
app.use('/api/individual/workshops', authRequired, individualWorkshops);
app.use('/api/individual/dashboard', authRequired, individualDashboard);
app.use('/api/individual/orders', authRequired, individualOrders);
app.use('/api/individual/attendance', authRequired, individualAttendance);
app.use('/api/individual/certificates', authRequired, individualCertificates);
app.use('/api/individual', authRequired, individualAuth);

// =========================
// E-LEARNING LEARNER PORTAL API
// =========================
app.use('/api/learner/player', authRequired, learnerPlayer);
app.use('/api/learner/courses', authRequired, learnerCourses);
app.use('/api/learner/dashboard', authRequired, learnerDashboard);
app.use('/api/learner/certificates', authRequired, learnerCertificates);
app.use('/api/learner', authRequired, learnerAuth);

// =========================
// ADMIN API
// =========================
app.use('/api/admin/dashboard', adminRequired, adminDashboard);
app.use('/api/admin/workshops', adminRequired, adminWorkshops);
app.use('/api/admin/workshop-menu', adminRequired, adminWorkshopMenu);
app.use('/api/admin/trainers', adminRequired, adminTrainers);
app.use('/api/admin/registrations', adminRequired, adminRegistrations);
app.use('/api/admin/elearning/:courseId/structure', adminRequired, adminLmsStructure);
app.use('/api/admin/elearning', adminRequired, adminElearning);
app.use('/api/admin/pages', adminRequired, adminPages);
app.use('/api/admin/contact', adminRequired, adminContact);
app.use('/api/admin/media', adminRequired, adminMedia);
app.use('/api/admin/users', adminRequired, adminUsers);
app.use('/api/admin/elearner-users', adminRequired, adminElearnerUsers);
app.use('/api/admin/banks', adminRequired, adminBanks);
app.use('/api/admin/invoices', adminRequired, adminInvoices);
app.use('/api/admin/manual-invoices', adminRequired, adminManualInvoice);
app.use('/api/admin/participants', adminRequired, adminParticipants);
app.use('/api/admin/survey', adminRequired, adminSurvey);
app.use('/api/admin/invitations', adminRequired, adminInvitations);
app.use('/api/admin/certificates', adminRequired, adminCertificates);
app.use('/api/admin/banners', adminRequired, adminBanners);
app.use('/api/admin/import', adminRequired, adminImport);
app.use('/api/admin/settings', adminRequired, adminSettings);
app.use('/api/admin', adminRequired, adminAuth);

// =========================
// 404
// =========================
app.use((_req, res) => {
  res.status(404).json({
    error: 'Not found',
  });
});

// =========================
// Error Handler
// =========================
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
);

ensureElearnerSchema()
  .catch((err) => {
    console.error('E-learner schema ensure failed on startup:', err);
  })
  .finally(() => {
    app.listen(config.port, () => {
      console.log(
        `UASA Training API running on http://localhost:${config.port}`
      );
    });
  });