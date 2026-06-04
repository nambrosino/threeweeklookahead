import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { visionComplete } from '@/lib/openrouter';
import { TRADE_COLOR_MAP_PROMPT } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const SYSTEM_PROMPT = `You are a construction schedule reader analyzing a pull plan board photo.

The board has ROWS on the left side labeled with area/level combinations:
- AREA A (Roof), AREA A (3rd Floor), AREA A (2nd Floor), AREA A (1st Floor)
- AREA B (Roof), AREA B (3rd Floor), AREA B (2nd Floor), AREA B (1st Floor)
- AREA C (Lower), AREA C (Upper)
- AREA D
- SITEWORK
- CMU SHAFTS

The board has COLUMNS across the top labeled with days (MON 5/25, TUES 5/26, etc.)
OR weeks (WEEK OF: 6/22, WEEK OF: 6/29, etc.).

X marks in cells = weekends/non-working days. Ignore them.
A pink vertical line = today marker. Ignore it.

Return ONLY valid JSON, no markdown, no explanation:
{
  "board_format": "daily" or "weekly",
  "activities": [
    {
      "area": "A" | "B" | "C" | "D" | "sitework" | "cmu",
      "area_sub": "roof" | "3rd" | "2nd" | "1st" | "lower" | "upper" | null,
      "level": 0-3,
      "day_key": "mon"|"tue"|"wed"|"thu"|"fri"|"sat" (for daily boards, null for weekly),
      "week_of": "2026-06-22" (ISO date, for weekly boards, null for daily),
      "trade": "trade_key from color map",
      "task_name": "text from top of card",
      "predecessor": "text from middle of card (hand-off trigger)",
      "crew_size": integer or null,
      "duration_days": integer or null,
      "duration_text": "raw duration text if not a clean integer",
      "is_milestone": true if card is rotated 45° into a diamond shape,
      "confidence": 0.0-1.0
    }
  ]
}`;

interface ExtractedActivity {
  area: string;
  area_sub: string | null;
  level: number;
  day_key: string | null;
  week_of: string | null;
  trade: string;
  task_name: string;
  predecessor: string | null;
  crew_size: number | null;
  duration_days: number | null;
  duration_text: string | null;
  is_milestone: boolean;
  confidence: number;
}

export async function POST(req: NextRequest) {
  const { uploadId, projectId } = await req.json();

  if (!uploadId || !projectId) {
    return NextResponse.json({ error: 'uploadId and projectId required' }, { status: 400 });
  }

  await supabase.from('uploads').update({ status: 'extracting' }).eq('id', uploadId);

  const { data: legendRows } = await supabase
    .from('trade_legends')
    .select('*')
    .eq('project_id', projectId);

  let colorMapString = TRADE_COLOR_MAP_PROMPT;
  if (legendRows && legendRows.length > 0) {
    const lines = legendRows.map(
      (l: { color_hex: string; trade_key: string; company_name: string }) =>
        `- ${l.color_hex}: ${l.trade_key} — ${l.company_name}`
    );
    colorMapString = `TRADE COLOR MAP FOR THIS PROJECT:\n${lines.join('\n')}`;
  }

  const { data: upload } = await supabase
    .from('uploads')
    .select('*')
    .eq('id', uploadId)
    .single();

  if (!upload) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
  }

  const allActivities: object[] = [];

  for (const photoUrl of upload.photo_urls) {
    try {
      const imgRes = await fetch(photoUrl);
      const arrayBuf = await imgRes.arrayBuffer();
      const base64Data = Buffer.from(arrayBuf).toString('base64');
      const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];

      const prompt = `${SYSTEM_PROMPT}\n\n${colorMapString}\n\nExtract all task cards from this pull plan board.`;
      const text = await visionComplete(prompt, base64Data, mediaType);
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const extracted = JSON.parse(cleaned);

      for (const act of (extracted.activities as ExtractedActivity[])) {
        const needsReview =
          act.confidence < 0.8 || act.crew_size === null || act.duration_days === null;

        allActivities.push({
          upload_id: uploadId,
          project_id: projectId,
          area: act.area,
          area_sub: act.area_sub ?? null,
          level: act.level ?? 0,
          day_key: act.day_key ?? null,
          week_of: act.week_of ?? null,
          trade: act.trade,
          task_name: act.task_name,
          predecessor: act.predecessor ?? null,
          crew_size: act.crew_size ?? null,
          duration_days: act.duration_days ?? null,
          duration_text: act.duration_text ?? null,
          is_milestone: act.is_milestone ?? false,
          is_starred: false,
          status: 'green',
          constraint_text: null,
          confidence: act.confidence ?? 1.0,
          needs_review: needsReview,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Extraction failed for photo:', photoUrl, msg);
      allActivities.push({
        upload_id: uploadId,
        project_id: projectId,
        area: 'A',
        area_sub: null,
        level: 0,
        day_key: null,
        week_of: null,
        trade: 'doc',
        task_name: `[Extraction failed: ${msg.substring(0, 80)}]`,
        predecessor: null,
        crew_size: null,
        duration_days: null,
        duration_text: null,
        is_milestone: false,
        is_starred: false,
        status: 'green',
        constraint_text: null,
        confidence: 0,
        needs_review: true,
      });
    }
  }

  if (allActivities.length > 0) {
    await supabase.from('activities').insert(allActivities);
  }

  await supabase.from('uploads').update({ status: 'review' }).eq('id', uploadId);
  return NextResponse.json({ ok: true, count: allActivities.length });
}
