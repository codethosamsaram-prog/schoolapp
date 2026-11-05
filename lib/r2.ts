import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Cloudflare R2 through its S3-compatible API: 10 GB free each month and no
 * egress charges, so photos, documents and generated PDFs cost nothing to
 * serve. Objects are reached only through short-lived presigned URLs; the
 * bucket itself stays private.
 *
 * One bucket holds everything, keyed <logical bucket>/<tenant path>, e.g.
 * avatars/<school_id>/<student_id>-abc.jpg.
 *
 * Server code only (it holds the secret key), but without 'server-only' so
 * the test suite can exercise it directly. Import it through lib/storage.ts.
 */

export interface R2Config {
  /** https://<account_id>.r2.cloudflarestorage.com unless overridden (tests, MinIO). */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Reads R2_* variables; null when any required one is missing. */
export function r2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const endpoint = env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), bucket, accessKeyId, secretAccessKey };
}

const clients = new Map<string, S3Client>();

function client(config: R2Config): S3Client {
  const cacheKey = `${config.endpoint}|${config.accessKeyId}`;
  let existing = clients.get(cacheKey);
  if (!existing) {
    existing = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      // Path-style keeps the bucket out of the hostname, which R2 accepts and
      // local stand-ins require.
      forcePathStyle: true,
      // The SDK's default CRC checksums end up in presigned URLs, and R2 refuses them.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    clients.set(cacheKey, existing);
  }
  return existing;
}

export function r2Key(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

export async function presignGet(
  config: R2Config,
  key: string,
  ttlSeconds: number,
  options: { downloadName?: string; inline?: boolean } = {},
): Promise<string> {
  const disposition = options.downloadName
    ? `${options.inline ? 'inline' : 'attachment'}; filename="${options.downloadName.replace(/"/g, '')}"`
    : undefined;
  return getSignedUrl(
    client(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key, ResponseContentDisposition: disposition }),
    { expiresIn: ttlSeconds },
  );
}

/**
 * A presigned PUT bound to one content type and exact size: both are signed
 * headers, so the browser cannot upload anything larger or of another type
 * than the server approved.
 */
export async function presignPut(
  config: R2Config,
  key: string,
  contentType: string,
  contentLength: number,
  ttlSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    client(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      CacheControl: 'private, max-age=3600',
    }),
    { expiresIn: ttlSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

export async function putObject(config: R2Config, key: string, body: Uint8Array, contentType: string) {
  await client(config).send(
    new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(config: R2Config, key: string): Promise<Buffer> {
  const response = await client(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!response.Body) throw new Error('empty object');
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function removeObjects(config: R2Config, keys: string[]) {
  await client(config).send(
    new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

export async function objectExists(config: R2Config, key: string): Promise<boolean> {
  try {
    await client(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === 'NotFound') return false;
    throw error;
  }
}
