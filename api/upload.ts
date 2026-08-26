import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filename, contentType } = req.body;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Blob token not configured' });
  }

  return res.status(200).json({
    token,
    uploadUrl: `https://blob.vercel-storage.com/${encodeURIComponent(filename)}`,
  });
}
