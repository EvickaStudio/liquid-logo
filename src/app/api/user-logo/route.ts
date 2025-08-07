import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function POST(request: Request): Promise<NextResponse> {
  if (!request.body) {
    return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
  }

  const imageId = ulid();
  const fileName = `${imageId}.png`;

  // No-op storage: do not persist user images server-side.
  // This endpoint only returns an ID for client-side navigation.

  return NextResponse.json({ imageId });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  const baseDir = join(process.cwd(), '.data', 'uploads');
  try {
    const file = await import('node:fs/promises');
    const blob = await file.readFile(join(baseDir, `${id}.png`));
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    // Fallback to bundled example so demo always works without server storage
    try {
      const file = await import('node:fs/promises');
      const examplePath = join(process.cwd(), 'public', 'examples', 'apple-logo.svg');
      const svg = await file.readFile(examplePath);
      return new Response(svg, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}
