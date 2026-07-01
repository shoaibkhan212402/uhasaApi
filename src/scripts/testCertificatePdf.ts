import { writeFileSync } from 'fs';
import { certificateDataToPdf } from '../services/certificatePdfService.js';

const data = {
  participantName: 'DINA MHD ZAKOUAN ALMOKID',
  workshopTitle: 'Regulatory Compliance and Cybersecurity Governance in Regulated Environments',
  workshopDates: 'Held on 09 June 2026',
  referenceNumber: 'RCC-09JUN26',
  cpdHours: 5,
  category: 'AML / Cybersecurity / Securities Innovation',
};

const pdf = await certificateDataToPdf(data);
writeFileSync('test-certificate.pdf', pdf);
console.log('Wrote test-certificate.pdf', pdf.length, 'bytes');
