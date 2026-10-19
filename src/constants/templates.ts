export interface AspectConfig {
  key: string;
  value: string;
  label: string;
  width: number;
  height: number;
}

export const ASPECTS: Record<string, AspectConfig> = {
  square: { key: 'square', value: '1 / 1', label: 'Feed Persegi 1:1', width: 1080, height: 1080 },
  portrait: { key: 'portrait', value: '4 / 5', label: 'Feed Potret 4:5', width: 1080, height: 1350 },
  story: { key: 'story', value: '9 / 16', label: 'Story / Reel 9:16', width: 1080, height: 1920 },
};

export interface TemplateConfig {
  key: string;
  label: string;
  description: string;
  aspect: string;
  ink: 'light' | 'dark';
  background: string;
  accent: string;
  category?: string;
  strip?: string;
  subline?: string;
}

export const TEMPLATES: TemplateConfig[] = [
  // ── 1. TECH: Cyberpunk ──────────────────────────────────────────────────
  {
    key: 'cyberpunk',
    label: 'Cyberpunk',
    description: 'Tech cyberpunk futuristik — hitam pekat solid bergrid sirkuit neon hijau.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0a0e17',
    accent: '#00ff66',
    category: 'tech',
    strip: '[HUD // ENCRYPTED 256-BIT]',
    subline: 'TERMINAL BROADCAST',
  },

  // ── 2. POP: Neo-Brutalisme ──────────────────────────────────────────────
  {
    key: 'neobrutalism',
    label: 'Neo-Brutalism',
    description: 'Pop modern bold — kuning elektrik solid dengan polkadot kontras tinggi.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#ffe600',
    accent: '#000000',
    category: 'pop',
    strip: '★ RAW CONFESSION ★',
    subline: 'POPARTS EDITION',
  },

  // ── 3. ROCK: Rock Grunge ────────────────────────────────────────────────
  {
    key: 'rock',
    label: 'Rock Grunge',
    description: 'Underground rock & metal — hitam pekat bergaris tajam merah darah menyala.',
    aspect: 'portrait',
    ink: 'light',
    background: '#121212',
    accent: '#ff003c',
    category: 'rock',
    strip: '/// ROCK ARCHIVE // SIDE A ///',
    subline: 'UNFILTERED SOUNDS',
  },

  // ── 4. TECH: Terminal Hacker ────────────────────────────────────────────
  {
    key: 'terminal',
    label: 'Terminal Dev',
    description: 'Konsol developer retro-modern — hitam terminal solid bergaris scanline cyan.',
    aspect: 'portrait',
    ink: 'light',
    background: '#080c10',
    accent: '#00f0ff',
    category: 'tech',
    strip: '● ● ● bash - session_01',
    subline: 'SYSTEM OUTPUT // 200 OK',
  },

  // ── 5. POP: Bubblegum Y2K ───────────────────────────────────────────────
  {
    key: 'bubblegum',
    label: 'Bubblegum Pop',
    description: 'Pop ceria & estetik Y2K — merah muda permen solid beraksen bintang retro.',
    aspect: 'portrait',
    ink: 'light',
    background: '#ff4b8b',
    accent: '#ffffff',
    category: 'pop',
    strip: '✦ SWEET CONFESSION ✦',
    subline: 'Y2K RETRO ARCHIVE',
  },

  // ── 6. MODERN: Swiss Minimalist ─────────────────────────────────────────
  {
    key: 'swiss',
    label: 'Swiss Design',
    description: 'Tipografi modern arsitektural — putih gading solid bergrid minimalis presisi.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#f4f4f0',
    accent: '#e63946',
    category: 'modern',
    strip: '№ 01 / ZÜRICH EDITORIAL',
    subline: 'ARCHITECTURAL GRID',
  },

  // ── 7. MODERN/TECH: Acid Techno ─────────────────────────────────────────
  {
    key: 'acid',
    label: 'Acid Techno',
    description: 'Kultur rave & synthesizer — ungu malam pekat dengan gelombang limau tajam.',
    aspect: 'portrait',
    ink: 'light',
    background: '#180828',
    accent: '#ccff00',
    category: 'modern',
    strip: '[145 BPM // RAW FREQUENCY]',
    subline: 'UNDERGROUND SOUND',
  },

  // ── 8. MODERN: Monochrome Bold ──────────────────────────────────────────
  {
    key: 'monochrome',
    label: 'Monochrome',
    description: 'Minimalis streetwear — putih bersih bertekstur crosshairs hitam kontras.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#ffffff',
    accent: '#000000',
    category: 'modern',
    strip: '“CONFESSION” — SPEC 2026',
    subline: 'STREETWEAR ARCHIVE',
  },

  // ── 9. ROCK: Indie Cassette ─────────────────────────────────────────────
  {
    key: 'indie',
    label: 'Indie Rock',
    description: 'Indie rock & pita kaset analog — merah bata terakota bertekstur arsir vintage.',
    aspect: 'portrait',
    ink: 'light',
    background: '#b84227',
    accent: '#fdf0d5',
    category: 'rock',
    strip: '[ CASSETTE SIDE A // 45 RPM ]',
    subline: 'ANALOG MASTER TAPE',
  },

  // ── 10. TECH: Blueprint Schematic ───────────────────────────────────────
  {
    key: 'blueprint',
    label: 'Blueprint Tech',
    description: 'Skematik teknik digital — biru kobalt solid dengan kisi blueprint kalkulasi.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0a2d54',
    accent: '#48cae4',
    category: 'tech',
    strip: 'DWG NO: FNC-2026 // REV A',
    subline: 'SCALE: 1:1 SCHEMATIC',
  },

  // ── Standar Fallback ────────────────────────────────────────────────────
  {
    key: 'default',
    label: 'Standar Fess',
    description: 'Biru royal solid khas Fess n Curious bertekstur titik halus.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0038ff',
    accent: '#ffffff',
    category: 'standard',
    strip: 'FESS N CURIOUS',
    subline: 'INSTAGRAM FEED',
  },
];

export function getTemplateByKey(key: string): TemplateConfig {
  return TEMPLATES.find((t) => t.key === key) || TEMPLATES[0];
}
