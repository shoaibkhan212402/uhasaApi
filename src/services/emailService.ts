import nodemailer from 'nodemailer';
import { insert } from '../db/pool.js';
import { config } from '../config.js';

export type EmailTemplate = 'confirmation' | 'invoice' | 'reminder' | 'zoom' | 'survey' | 'invitation' | 'certificate';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  templateType: EmailTemplate;
  participantId?: number;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, html, templateType, participantId, attachments } = options;
  const from = `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`;

  try {
    const transport = getTransporter();
    if (transport) {
      await transport.sendMail({
        from,
        to,
        subject,
        html,
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });
    } else if (config.nodeEnv === 'development') {
      console.log('\n--- EMAIL (dev, no SMTP) ---');
      console.log('To:', to);
      console.log('Subject:', subject);
      if (attachments?.length) {
        console.log('Attachments:', attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(', '));
      }
      console.log(html.slice(0, 500));
      console.log('--- END EMAIL ---\n');
    } else {
      throw new Error('SMTP not configured');
    }

    await insert(
      `INSERT INTO email_log (recipient, subject, template_type, participant_id, status) VALUES (?, ?, ?, ?, 'sent')`,
      [to, subject, templateType, participantId || null]
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed';
    await insert(
      `INSERT INTO email_log (recipient, subject, template_type, participant_id, status, error_message) VALUES (?, ?, ?, ?, 'failed', ?)`,
      [to, subject, templateType, participantId || null, message]
    );
    console.error('Email send failed:', message);
    return false;
  }
}

export function confirmationEmailHtml(data: {
  participantName: string;
  workshopTitle: string;
  startDate: string;
  timeSlot: string;
  organizationName: string;
}) {
  return `
    <h2>Registration Confirmation</h2>
    <p>Dear ${data.participantName},</p>
    <p>Your registration for <strong>${data.workshopTitle}</strong> has been confirmed.</p>
    <ul>
      <li><strong>Date:</strong> ${data.startDate}</li>
      <li><strong>Time:</strong> ${data.timeSlot}</li>
      <li><strong>Organization:</strong> ${data.organizationName}</li>
    </ul>
    <p>You will receive a reminder email before the workshop and a Zoom link on the day of the event.</p>
    <p>Best regards,<br>UASA Training</p>
  `;
}

export function invoiceEmailHtml(data: {
  invoiceNumber: string;
  recipientName: string;
  participantName: string;
  workshopTitle: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
}) {
  return `
    <h2>Invoice ${data.invoiceNumber}</h2>
    <p>Dear ${data.recipientName},</p>
    <p>Please find your tax invoice attached as a PDF for the following workshop registration:</p>
    <ul>
      <li><strong>Participant:</strong> ${data.participantName}</li>
      <li><strong>Workshop:</strong> ${data.workshopTitle}</li>
      <li><strong>Amount:</strong> AED ${data.amount.toFixed(2)}</li>
      <li><strong>VAT (5%):</strong> AED ${data.vatAmount.toFixed(2)}</li>
      <li><strong>Total:</strong> AED ${data.totalAmount.toFixed(2)}</li>
    </ul>
    <p>Best regards,<br>UASA Training</p>
  `;
}

export function reminderEmailHtml(data: {
  participantName: string;
  workshopTitle: string;
  startDate: string;
  timeSlot: string;
}) {
  return `
    <h2>Workshop Reminder</h2>
    <p>Dear ${data.participantName},</p>
    <p>This is a reminder that <strong>${data.workshopTitle}</strong> is coming up on <strong>${data.startDate}</strong> at ${data.timeSlot}.</p>
    <p>Best regards,<br>UASA Training</p>
  `;
}

export function zoomEmailHtml(data: {
  participantName: string;
  workshopTitle: string;
  zoomLink: string;
}) {
  return `
    <h2>Zoom Link — ${data.workshopTitle}</h2>
    <p>Dear ${data.participantName},</p>
    <p>Please join the workshop using the link below:</p>
    <p><a href="${data.zoomLink}">${data.zoomLink}</a></p>
    <p>Best regards,<br>UASA Training</p>
  `;
}

export function surveyEmailHtml(data: {
  participantName: string;
  workshopTitle: string;
  surveyUrl: string;
}) {
  return `
    <h2>Workshop Survey — ${data.workshopTitle}</h2>
    <p>Dear ${data.participantName},</p>
    <p>Thank you for attending <strong>${data.workshopTitle}</strong>. We would appreciate your feedback:</p>
    <p><a href="${data.surveyUrl}">Complete the survey</a></p>
    <p>Best regards,<br>UASA Training</p>
  `;
}
