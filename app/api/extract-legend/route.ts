import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { visionComplete } from '@/lib/openrouter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  const { uploadId, projectId, photoUrls } = await req.json();

  if (!projectId || !photoUrls?.length) {
    return NextResponse.json({ error: 'projectId and photoUrls required' }, { status: 400 });
  }

  try {
    const imgRes = await fetch(photoUrls[0]);
    const arrayBuf = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuf).toString('base64');
    const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];

    const prompt = `You are reading the legend/key section of a construction pull plan board.
Extract each trade entry showing a color swatch paired with a trade name and company.

Return ONLY valid JSON, no markdown:
{
  "trades": [
    {
      "color_hex": "#rrggbb",
      "trade_key": "short_snake_case_key",
      "company_name": "Company Name",
      "trade_name": "Trade description"
    }
  ]
}

Extract all trade color legend entries from this photo.`;

    const text = await visionComplete(prompt, base64Data, mediaType);
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.trades?.length) {
      await supabase.from('trade_legends').delete().eq('project_id', projectId);
      await supabase.from('trade_legends').insert(
        parsed.trades.map((t: { color_hex: string; trade_key: string; company_name: string }) => ({
          project_id: projectId,
          color_hex: t.color_hex,
          trade_key: t.trade_key,
          company_name: t.company_name,
        }))
      );
    }

    if (uploadId) {
      await supabase.from('uploads').update({ status: 'published' }).eq('id', uploadId);
    }

    return NextResponse.json({ ok: true, count: parsed.trades?.length ?? 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Legend extraction failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
