import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET() {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('Say "OK" and nothing else.');
    const text = result.response.text();
    return NextResponse.json({ ok: true, response: text, keyPrefix: key.substring(0, 8) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
