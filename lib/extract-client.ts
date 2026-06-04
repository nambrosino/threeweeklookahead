// Client-side extraction — calls OpenRouter directly from the browser.
// Safe for a password-protected internal tool.

const MODEL = 'google/gemini-3.5-flash';

function getOpenRouterKey(): string {
  // Key is injected at build time via NEXT_PUBLIC_ prefix
  return process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? '';
}

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  // Resize to max 2400px — keep resolution high for handwritten text
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 2400;
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

CRITICAL: Extract EVERY sticky note / colored card visible on the board. Do not skip any.

The board has ROWS on the left side labeled with area/level combinations:
- AREA A (Roof) = area:"A", area_sub:"roof", level:3
- AREA A (3rd Floor) = area:"A", area_sub:"3rd", level:2
- AREA A (2nd Floor) = area:"A", area_sub:"2nd", level:1
- AREA A (1st Floor) = area:"A", area_sub:"1st", level:0
- AREA B (Roof) = area:"B", area_sub:"roof", level:3
- AREA B (3rd Floor) = area:"B", area_sub:"3rd", level:2
- AREA B (2nd Floor) = area:"B", area_sub:"2nd", level:1
- AREA B (1st Floor) = area:"B", area_sub:"1st", level:0
- AREA C (Lower) = area:"C", area_sub:"lower", level:0
- AREA C (Upper) = area:"C", area_sub:"upper", level:1
- AREA D = area:"D", area_sub:null, level:0
- SITEWORK = area:"sitework", area_sub:null, level:0
- CMU SHAFTS = area:"cmu", area_sub:null, level:0

If area labels are not visible on the left (continuation panel), use your best judgment based on row position.

Columns are days (MON 5/25, TUES 5/26…) — use day_key: "mon","tue","wed","thu","fri","sat"
OR weeks (WEEK OF: 6/22…) — use week_of: "2025-06-22" ISO format.

X marks in cells = non-working days, ignore them.
Pink vertical line = today marker, ignore it.
"FOREMAN'S MEETING" text = ignore it.
"MEMORIAL DAY" text = ignore it.

For each sticky note/card extract:
- task_name: the main text on the card (top line)
- predecessor: any text indicating what must happen first (often "__ complete" or "after __")
- crew_size: the number before the | or / symbol (e.g. "2|6" means crew_size=2)
- duration_days: the number after the | or / symbol (e.g. "2|6" means duration=6 days, "1 day" means 1)
- trade: match the card color to the trade color map

Return ONLY valid JSON, no markdown, no explanation:
{"board_format":"daily","activities":[{"area":"A","area_sub":"roof","level":3,"day_key":"mon","week_of":null,"trade":"trade_key","task_name":"text","predecessor":null,"crew_size":2,"duration_days":6,"duration_text":null,"is_milestone":false,"confidence":0.85}]}`;

export async function extractBoardFromFile(
  file: File,
  colorMapString: string,
): Promise<{ board_format: string; activities: unknown[] }> {
  const { base64, mimeType } = await fileToBase64(file);
  const prompt = `${BOARD_PROMPT}\n\n${colorMapString}\n\nExtract all task cards from this pull plan board.`;
  const text = await callVision(prompt, base64, mimeType);
  console.log('=== RAW AI RESPONSE ===');
  console.log(text);
  console.log('=== END RESPONSE ===');
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  console.log('Parsed activities count:', parsed.activities?.length ?? 0);
  return parsed;
}
