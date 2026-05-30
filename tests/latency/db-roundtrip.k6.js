import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
  },
};

const supabaseUrl = __ENV.SUPABASE_URL;
const anonKey = __ENV.ANON_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL is required');
}

if (!anonKey) {
  throw new Error('ANON_KEY is required');
}

const baseUrl = supabaseUrl.replace(/\/$/, '');
const url = `${baseUrl}/rest/v1/companies?select=id&limit=1`;

export default function () {
  const response = http.get(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });

  check(response, {
    'status is 200': (res) => res.status === 200,
  });
}
