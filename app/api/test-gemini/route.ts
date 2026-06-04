import { NextResponse } from 'next/server';
import { visionComplete } from '@/lib/openrouter';

export async function GET() {
  try {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });

    // Use a tiny 1x1 white pixel PNG for the test
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
    const text = await visionComplete('Say "OK" and nothing else.', pixel, 'image/png');
    return NextResponse.json({ ok: true, response: text, keyPrefix: key.substring(0, 12) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
