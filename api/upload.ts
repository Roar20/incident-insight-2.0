import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

/** Reject anything larger than this before a byte is written to the store. */
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
];

/**
 * Mints a short-lived, single-upload client token for the browser.
 *
 * This deliberately never returns BLOB_READ_WRITE_TOKEN: that credential grants
 * read, write and delete across the whole store, so handing it to the client
 * would let any caller of this endpoint take over the blob store. `handleUpload`
 * signs a token scoped to one pathname, content type and size limit instead.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Blob storage is not configured' });
  }

  try {
    const body = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        // Prevent one caller's upload from overwriting another's by path.
        addRandomSuffix: true,
        tokenPayload: null,
      }),
      // Nothing to reconcile server-side; /api/process is driven by the client.
      onUploadCompleted: async () => {},
    });

    return res.status(200).json(body);
  } catch (e) {
    // handleUpload throws on an invalid body or a failed callback signature.
    const message = e instanceof Error ? e.message : 'Upload request rejected';
    return res.status(400).json({ error: message });
  }
}
