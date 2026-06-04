export const TRADE_COLORS: Record<string, { hex: string; name: string; company: string }> = {
  di_gregorio: { hex: '#c06010', name: 'Sitework', company: 'Di Gregorio' },
  marguerite:  { hex: '#3a8a20', name: 'Concrete', company: 'Marguerite' },
  rossi:       { hex: '#c03060', name: 'Electric', company: 'Rossi' },
  grodsky_plumbing: { hex: '#a08000', name: 'Plumbing', company: 'Grodsky' },
  wolverine:   { hex: '#0080b0', name: 'Fire Protection', company: 'Wolverine' },
  brunca:      { hex: '#7040c0', name: 'Waterproofing', company: 'Brunca' },
  hb_welding:  { hex: '#4060a0', name: 'Structural Steel', company: 'HB Welding' },
  doc:         { hex: '#208020', name: 'CM', company: 'DOC' },
  grodsky_hvac:{ hex: '#0098b0', name: 'HVAC', company: 'Grodsky' },
  sweeney:     { hex: '#c03020', name: 'Drywall', company: 'Sweeney' },
  spino:       { hex: '#804018', name: 'Masonry', company: 'Spino' },
  greenwood:   { hex: '#707010', name: 'Roofing', company: 'Greenwood' },
  nrd:         { hex: '#808080', name: 'Metal Panels', company: 'NRD' },
  cherry_hill: { hex: '#c08060', name: 'Windows', company: 'Cherry Hill' },
  canavan:     { hex: '#a8a020', name: 'Surveyor', company: 'Canavan' },
};

export const AREA_COLORS: Record<string, string> = {
  A: '#2a6a2a',
  B: '#c06010',
  C: '#c03020',
  D: '#3060a0',
  sitework: '#a08000',
  cmu: '#808080',
};

export const AREA_ROWS = [
  { area: 'A', area_sub: 'roof',  level: 3, label: 'AREA A (Roof)' },
  { area: 'A', area_sub: '3rd',   level: 2, label: 'AREA A (3rd Floor)' },
  { area: 'A', area_sub: '2nd',   level: 1, label: 'AREA A (2nd Floor)' },
  { area: 'A', area_sub: '1st',   level: 0, label: 'AREA A (1st Floor)' },
  { area: 'B', area_sub: 'roof',  level: 3, label: 'AREA B (Roof)' },
  { area: 'B', area_sub: '3rd',   level: 2, label: 'AREA B (3rd Floor)' },
  { area: 'B', area_sub: '2nd',   level: 1, label: 'AREA B (2nd Floor)' },
  { area: 'B', area_sub: '1st',   level: 0, label: 'AREA B (1st Floor)' },
  { area: 'C', area_sub: 'lower', level: 0, label: 'AREA C (Lower)' },
  { area: 'C', area_sub: 'upper', level: 1, label: 'AREA C (Upper)' },
  { area: 'D', area_sub: null,    level: 0, label: 'AREA D' },
  { area: 'sitework', area_sub: null, level: 0, label: 'SITEWORK' },
  { area: 'cmu',      area_sub: null, level: 0, label: 'CMU SHAFTS' },
];

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const DAY_LABELS: Record<string, string> = {
  mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT',
};

// Color map string injected into Claude prompt
export const TRADE_COLOR_MAP_PROMPT = `TRADE COLOR MAP FOR THIS PROJECT:
- Orange (#E07020): di_gregorio — Di Gregorio Sitework
- Bright green (#5aaa30): marguerite — Marguerite Concrete
- Pink/salmon (#e05080): rossi — Rossi Electric (similar to Cherry Hill windows peach — check carefully)
- Yellow (#d4aa00): grodsky_plumbing — Grodsky Plumbing (similar to Canavan surveyor yellow-green — check carefully)
- Light blue (#30b8d0): wolverine — Wolverine Fire Protection
- Lavender/purple (#a060d0): brunca — Brunca Waterproofing
- Blue-gray (#6080b0): hb_welding — HB Welding Structural Steel
- Dark green (#3a9a3a): doc — DOC Construction Manager (also used for milestone/phase markers)
- Teal/cyan (#60c8e0): grodsky_hvac — Grodsky HVAC
- Red (#e04030): sweeney — Sweeney Drywall
- Brown/rust (#b06030): spino — Spino Masonry
- Tan/peach (#909020): greenwood — Greenwood Roofing
- Gray (#909090): nrd — NRD Metal Panels
- Light pink (#f0b090): cherry_hill — Cherry Hill Windows
- Yellow-green (#d4d060): canavan — Canavan Surveyor
- White (rotated 45° diamond): ANY TRADE — Milestone/Phase marker`;
