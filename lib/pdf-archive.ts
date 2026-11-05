import 'server-only';

import crypto from 'node:crypto';
import type { ReactElement } from 'react';
import { NextResponse } from 'next/server';
import { renderToBuffer, renderToStream, type DocumentProps } from '@react-pdf/renderer';
import { getPresignedUrl, r2FileExists, storageProvider, uploadFile } from '@/lib/storage';

const ARCHIVE_BUCKET = 'generated-pdfs';
const LINK_TTL_SECONDS = 5 * 60;

export interface PdfResponseOptions {
  document: ReactElement<DocumentProps>;
  schoolId: string;
  kind: 'payslips' | 'receipts';
  id: string;
  filename: string;
  disposition: 'inline' | 'attachment';
}

/**
 * Serves a generated PDF. The caller has already authorised the reader.
 *
 * On R2 the PDF is rendered once, kept, and served by a short-lived redirect,
 * so repeat views cost neither function time nor egress. The object name
 * includes a hash of everything printed on it, so a voided receipt or a changed
 * balance renders a new copy rather than serving a stale one. If R2 fails, the
 * reader still gets the PDF directly.
 *
 * On Supabase it is rendered on each request, as it always has been.
 */
export async function pdfResponse(options: PdfResponseOptions): Promise<NextResponse> {
  const { document, filename, disposition } = options;
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${disposition}; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  };

  if (storageProvider() !== 'r2') {
    const stream = await renderToStream(document);
    return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, { headers });
  }

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(document.props)).digest('hex').slice(0, 16);
  const path = `${options.schoolId}/${options.kind}/${options.id}-${fingerprint}.pdf`;
  let rendered: Buffer | null = null;

  try {
    if (!(await r2FileExists(ARCHIVE_BUCKET, path))) {
      rendered = await renderToBuffer(document);
      await uploadFile(ARCHIVE_BUCKET, path, rendered, 'application/pdf');
    }
    const url = await getPresignedUrl(ARCHIVE_BUCKET, path, {
      ttlSeconds: LINK_TTL_SECONDS,
      downloadName: filename,
      inline: disposition === 'inline',
    });
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('Cache-Control', 'private, no-store');
    return redirect;
  } catch (error) {
    console.error('[pdf-archive] serving directly', {
      kind: options.kind,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return new NextResponse(new Uint8Array(rendered ?? (await renderToBuffer(document))), { headers });
  }
}
