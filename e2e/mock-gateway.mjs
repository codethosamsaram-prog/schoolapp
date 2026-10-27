/**
 * Stand-in for Razorpay and the Meta Graph API during e2e runs.
 *
 * The app reaches it through RAZORPAY_API_BASE_URL and WHATSAPP_GRAPH_BASE_URL
 * (see playwright.config.ts). Every call is recorded so tests can assert what
 * the app sent, and template statuses can be changed between tests.
 *
 *   GET    /__health             readiness probe for Playwright
 *   GET    /__requests           calls received so far
 *   POST   /__reset              forget calls, approve every template
 *   PUT    /__templates          { "<name>": "APPROVED" | "PENDING" | ... | null }
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_GATEWAY_PORT ?? 3199);
const RAZORPAY_KEY = 'rzp_test_e2e';
const META_TOKEN = 'e2e-token';
const TEMPLATE_NAMES = [
  'fee_due_reminder',
  'fee_payment_confirmation',
  'student_absence_alert',
  'admission_enquiry_ack',
];

let requests = [];
let templates = {};
let sequence = 0;

function reset() {
  requests = [];
  templates = Object.fromEntries(TEMPLATE_NAMES.map((name) => [name, 'APPROVED']));
}
reset();

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const body = await readBody(req);
  const path = url.pathname;

  if (path === '/__health') return send(res, 200, { ok: true });
  if (path === '/__requests') return send(res, 200, requests);
  if (path === '/__reset' && req.method === 'POST') {
    reset();
    return send(res, 200, { ok: true });
  }
  if (path === '/__templates' && req.method === 'PUT') {
    for (const [name, status] of Object.entries(body ?? {})) templates[name] = status;
    return send(res, 200, templates);
  }

  requests.push({ method: req.method, path, query: url.search, body });

  // Razorpay: POST /v1/payments/:id/refund
  const refund = path.match(/^\/v1\/payments\/([^/]+)\/refund$/);
  if (refund && req.method === 'POST') {
    const auth = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64')
      .toString('utf8')
      .split(':')[0];
    if (auth !== RAZORPAY_KEY) {
      return send(res, 401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
    }
    const paymentId = decodeURIComponent(refund[1]);
    if (paymentId.includes('DECLINE')) {
      return send(res, 400, {
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'The refund amount provided is greater than amount captured',
        },
      });
    }
    sequence += 1;
    return send(res, 200, {
      id: `rfnd_e2e${Date.now()}${sequence}`,
      entity: 'refund',
      amount: body?.amount,
      currency: 'INR',
      payment_id: paymentId,
      notes: body?.notes ?? [],
      status: 'processed',
      speed_processed: 'normal',
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  // Meta Graph: everything under /vNN.N/
  const graph = path.match(/^\/v\d+\.\d+\/([^/]+)(\/[a-z_]+)?$/);
  if (graph) {
    if (req.headers.authorization !== `Bearer ${META_TOKEN}`) {
      return send(res, 401, { error: { message: 'Invalid OAuth access token.', code: 190 } });
    }
    const [, id, edge] = graph;
    if (!edge && req.method === 'GET') {
      return send(res, 200, { id, display_phone_number: '+91 98100 00000', verified_name: 'ClassroomOS E2E' });
    }
    if (edge === '/message_templates' && req.method === 'GET') {
      const prefix = url.searchParams.get('name') ?? '';
      const data = Object.entries(templates)
        .filter(([name, status]) => status && name.startsWith(prefix))
        .map(([name, status]) => ({ name, status, language: 'en', id: `tpl_${name}` }));
      return send(res, 200, { data });
    }
    if (edge === '/messages' && req.method === 'POST') {
      sequence += 1;
      return send(res, 200, { messages: [{ id: `wamid.e2e.${sequence}` }] });
    }
  }

  return send(res, 404, { error: { message: `mock gateway has no route for ${req.method} ${path}` } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-gateway] listening on http://127.0.0.1:${PORT}`);
});
