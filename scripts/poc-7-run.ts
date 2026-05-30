import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.error('RESEND_API_KEY is missing');
  process.exit(1);
}

const resend = new Resend(apiKey);

const { data, error } = await resend.emails.send({
  from: 'onboarding@resend.dev',
  to: 'delivered@resend.dev',
  subject: 'PoC #7 Sprint α-0',
  html: '<p>test</p>',
});

if (typeof data?.id !== 'string' || data.id.length === 0) {
  console.error(error);
  process.exit(1);
}

console.log('PoC #7 OK — message id:', data.id);
process.exit(0);
