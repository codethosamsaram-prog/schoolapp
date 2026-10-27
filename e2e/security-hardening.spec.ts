import { createClient } from '@supabase/supabase-js';
import { expect, test, type APIResponse } from '@playwright/test';
import { APP_PORT, TENANT_A, USERS } from './constants';
import { anonKey, signIn, serviceDb, supabaseUrl, userDb } from './support';

/**
 * Edge hardening: security headers on every kind of response, sensitive APIs
 * closed to anonymous and under-privileged callers, Supabase Storage closed
 * to direct anonymous access, and rate limits on the sensitive API routes.
 */

const BASE = `http://localhost:${APP_PORT}`;

function expectSecurityHeaders(response: APIResponse, what: string) {
  const headers = response.headers();
  expect(headers['x-frame-options'], what).toBe('DENY');
  expect(headers['x-content-type-options'], what).toBe('nosniff');
  expect(headers['referrer-policy'], what).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy'], what).toContain('camera=()');
  expect(headers['permissions-policy'], what).toContain('geolocation=()');
  expect(headers['x-powered-by'], what).toBeUndefined();
}

/**
 * A client address from the 198.18.0.0/15 benchmarking range, unique per
 * call, so tests never share a rate-limit bucket. The second entry is what a
 * proxy would append; the limiter keys on the first.
 */
function freshIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `198.${18 + Math.floor(Math.random() * 2)}.${octet()}.${octet()}, 10.0.0.1`;
}

test.describe('security hardening', () => {
  test('pages, redirects and API responses all carry the security headers', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: BASE });
    const cases: [string, number][] = [
      ['/', 200],
      ['/login', 200],
      [`/${TENANT_A.slug}`, 200],
      [`/${TENANT_A.slug}/admin/dashboard`, 307], // bounced to /login
      ['/api/whatsapp/health', 401],
      ['/api/id-cards?grade=IX&section=A', 401],
    ];
    for (const [path, status] of cases) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expectSecurityHeaders(response, path);
    }
    await anonymous.dispose();
  });

  test('sensitive APIs answer 401 to anonymous callers and 403 to the wrong role', async ({ playwright, browser }) => {
    const anonymous = await playwright.request.newContext({ baseURL: BASE });
    const calls = [
      { method: 'post', path: '/api/payroll/process', data: { month: '2026-09', entries: [] } },
      { method: 'post', path: '/api/payments/refund', data: { payment_id: crypto.randomUUID(), reason: 'probe' } },
      { method: 'post', path: '/api/payments/create-order', data: { studentId: crypto.randomUUID() } },
      { method: 'get', path: '/api/whatsapp/health' },
      { method: 'get', path: '/api/id-cards?grade=IX&section=A' },
    ] as const;

    for (const call of calls) {
      const response =
        call.method === 'post'
          ? await anonymous.post(call.path, { data: call.data, headers: { 'x-forwarded-for': freshIp() } })
          : await anonymous.get(call.path, { headers: { 'x-forwarded-for': freshIp() } });
      expect(response.status(), `${call.path} anonymous`).toBe(401);
      // Errors are short messages, never stack traces or internals.
      const body = await response.json();
      expect(Object.keys(body), call.path).toEqual(['error']);
    }
    await anonymous.dispose();

    const context = await browser.newContext();
    const student = await context.newPage();
    await signIn(student, 'student');
    for (const call of calls.filter((entry) => entry.path !== '/api/payments/create-order')) {
      const response =
        call.method === 'post'
          ? await student.request.post(call.path, { data: call.data })
          : await student.request.get(call.path);
      expect(response.status(), `${call.path} as a student`).toBe(403);
    }
    await context.close();
  });

  test('Supabase Storage refuses direct anonymous access to private files', async () => {
    const service = serviceDb();
    const syllabus = `${TENANT_A.id}/syllabus/e2e-science.pdf`;
    const photo = `${TENANT_A.id}/e2e-probe.png`;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await service.storage.from('avatars').upload(photo, png, { contentType: 'image/png', upsert: true });

    // Positive control: the files exist, so every refusal below is the policy.
    expect((await service.storage.from('academic-docs').download(syllabus)).error).toBeNull();
    expect((await service.storage.from('avatars').download(photo)).error).toBeNull();

    const anonymous = createClient(supabaseUrl(), anonKey(), { auth: { persistSession: false } });
    for (const [bucket, path] of [
      ['academic-docs', syllabus],
      ['avatars', photo],
    ] as const) {
      const download = await anonymous.storage.from(bucket).download(path);
      expect(download.data, `${bucket} download`).toBeNull();

      const signed = await anonymous.storage.from(bucket).createSignedUrl(path, 60);
      expect(signed.data?.signedUrl, `${bucket} signed URL`).toBeFalsy();

      const listing = await anonymous.storage.from(bucket).list(TENANT_A.id);
      expect(listing.data ?? [], `${bucket} listing`).toEqual([]);

      const upload = await anonymous.storage.from(bucket).upload(`${TENANT_A.id}/intruder.txt`, 'x', { upsert: true });
      expect(upload.error, `${bucket} upload`).not.toBeNull();

      // Straight at the REST endpoints, as a script would try.
      const publicUrl = await fetch(`${supabaseUrl()}/storage/v1/object/public/${bucket}/${path}`);
      expect(publicUrl.status, `${bucket} public URL`).not.toBe(200);
      const raw = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}/${path}`, {
        headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` },
      });
      expect(raw.status, `${bucket} object endpoint`).not.toBe(200);
    }

    // Signed in, but to another school: still refused.
    const adminB = await userDb(USERS.adminB.email);
    expect((await adminB.storage.from('academic-docs').download(syllabus)).data).toBeNull();
    // And the school's own admin can read it.
    const adminA = await userDb(USERS.adminA.email);
    expect((await adminA.storage.from('academic-docs').download(syllabus)).error).toBeNull();

    await service.storage.from('avatars').remove([photo]);
  });

  test('sensitive API routes are rate limited per client', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: BASE });

    for (const probe of [
      { path: '/api/whatsapp/health', send: (ip: string) => anonymous.get('/api/whatsapp/health', { headers: { 'x-forwarded-for': ip } }) },
      {
        path: '/api/payroll/process',
        send: (ip: string) => anonymous.post('/api/payroll/process', { data: {}, headers: { 'x-forwarded-for': ip } }),
      },
    ]) {
      const ip = freshIp();
      const first = await probe.send(ip);
      const limit = Number(first.headers()['x-ratelimit-limit']);
      expect(limit, `${probe.path} advertises its limit`).toBeGreaterThan(0);
      expect(Number(first.headers()['x-ratelimit-remaining'])).toBe(limit - 1);

      const statuses = [first.status()];
      let blocked: APIResponse | null = null;
      for (let attempt = 1; attempt <= limit; attempt += 1) {
        const response = await probe.send(ip);
        statuses.push(response.status());
        if (response.status() === 429) blocked = response;
      }
      expect(statuses.slice(0, limit).every((status) => status === 401), probe.path).toBe(true);
      expect(statuses[limit], `${probe.path} request ${limit + 1}`).toBe(429);
      expect(Number(blocked!.headers()['retry-after'])).toBeGreaterThan(0);
      expect((await blocked!.json()).error).toContain('Too many requests');
      expectSecurityHeaders(blocked!, `${probe.path} 429`);

      // Another client is unaffected.
      expect((await probe.send(freshIp())).status(), `${probe.path} other client`).toBe(401);
    }
    await anonymous.dispose();
  });
});
