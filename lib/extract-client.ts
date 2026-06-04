// Client-side extraction — calls OpenRouter directly from the browser.
// Safe for a password-protected internal tool.

const MODEL = 'google/gemini-3.5-flash';

function getOpenRouterKey(): string {
  // Key is injected at build time via NEXT_PUBLIC_ prefix
  return process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? '';
}

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  // Resize to max 1600px to reduce token usage
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType: 'image/jpeg' });
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function callVision(prompt: string, base64: string, mimeType: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getOpenRouterKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://threeweeklookahead.netlify.app',
      'X-Title': 'DOC Pull Plan',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export async function extractLegendFromFile(
  file: File,
  projectId: string,
): Promise<{ color_hex: string; trade_key: string; company_name: string }[]> {
  const { base64, mimeType } = await fileToBase64(file);
  const prompt = `You are reading the legend/key section of a construction pull plan board.
Extract each trade entry showing a color swatch paired with a trade name and company.
Return ONLY valid JSON, no markdown:
{"trades":[{"color_hex":"#rrggbb","trade_key":"snake_case","company_name":"Company","trade_name":"Trade"}]}`;

  const text = await callVision(prompt, base64, mimeType);
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed.trades ?? [];
}

const BOARD_PROMPT = `You are a construction schedule reader analyzing a pull plan board photo.

The board has ROWS on the left side labeled with area/level combinations:
- AREA A (Roof), AREA A (3rd Floor), AREA A (2nd Floor), AREA A (1st Floor)
- AREA B (Roof), AREA B (3rd Floor), AREA B (2nd Floor), AREA B (1st Floor)
- AREA C (Lower), AREA C (Upper)
- AREA D / SITEWORK / CMU SHAFTS

Columns are days (MON 5/25, TUES 5/26…) or weeks (WEEK OF: 6/22…).
X marks = weekends, ignore. Pink line = today, ignore.

Return ONLY valid JSON, no markdown:
{"board_format":"daily","activities":[{"area":"A","area_sub":"roof","level":3,"day_key":"mon","week_of":null,"trade":"trade_key","task_name":"text","predecessor":"text or null","crew_size":2,"duration_days":1,"duration_text":null,"is_milestone":false,"confidence":0.9}]}`;

export async function extractBoardFromFile(
  file: File,
  colorMapString: string,
): Promise<{ board_format: string; activities: unknown[] }> {
  const { base64, mimeType } = await fileToBase64(file);
  const prompt = `${BOARD_PROMPT}\n\n${colorMapString}\n\nExtract all task cards from this pull plan board.`;
  const text = await callVision(prompt, base64, mimeType);
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}
