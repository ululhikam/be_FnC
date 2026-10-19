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
    strip: '* RAW CONFESSION *',
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
    strip: 'o o o bash - session_01',
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
    strip: '+ SWEET CONFESSION +',
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
    strip: 'No. 01 / ZURICH EDITORIAL',
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
    strip: '"CONFESSION" - SPEC 2026',
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

  // ── 11. LEGACY: Tengah Malam ────────────────────────────────────────────
  {
    key: 'midnight',
    label: 'Tengah Malam',
    description: 'Biru tua pekat bertekstur bintang — cocok untuk curhat malam.',
    aspect: 'portrait',
    ink: 'light',
    background: 'radial-gradient(120% 90% at 20% 0%, #16204d 0%, #0a0e22 45%, #05060f 100%)',
    accent: '#7dd3fc',
  },

  // ── 12. LEGACY: Senja ───────────────────────────────────────────────────
  {
    key: 'sunset',
    label: 'Senja',
    description: 'Oranye ke merah muda, hangat dan ramah di feed.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(160deg, #ff7a18 0%, #ff3d6e 52%, #a01fff 100%)',
    accent: '#fff4e8',
  },

  // ── 13. LEGACY: Rimba ───────────────────────────────────────────────────
  {
    key: 'forest',
    label: 'Rimba',
    description: 'Hijau teal yang menenangkan, pas untuk opini santai.',
    aspect: 'square',
    ink: 'light',
    background: 'linear-gradient(140deg, #0f766e 0%, #059669 55%, #34d399 100%)',
    accent: '#ecfdf5',
  },

  // ── 14. LEGACY: Noir ────────────────────────────────────────────────────
  {
    key: 'noir',
    label: 'Noir',
    description: 'Hitam pekat bergrid neon — gelap, tajam, misterius.',
    aspect: 'square',
    ink: 'light',
    background: 'linear-gradient(180deg, #0b0d14 0%, #12141f 60%, #0b0d14 100%)',
    accent: '#0038ff',
  },

  // ── 15. LEGACY: Kertas ──────────────────────────────────────────────────
  {
    key: 'paper',
    label: 'Kertas',
    description: 'Krem bersih bertekstur arsir — teks gelap, enak dibaca.',
    aspect: 'portrait',
    ink: 'dark',
    background: 'linear-gradient(150deg, #fdf6ec 0%, #f6ead6 60%, #efe0c6 100%)',
    accent: '#b45309',
  },

  // ── 16. LEGACY: Samudra ─────────────────────────────────────────────────
  {
    key: 'ocean',
    label: 'Samudra',
    description: 'Cyan ke biru tua, segar seperti biru laut.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(200deg, #22d3ee 0%, #0ea5e9 48%, #1e3a8a 100%)',
    accent: '#ecfeff',
  },

  // ── 17. LEGACY: Violet ──────────────────────────────────────────────────
  {
    key: 'violet',
    label: 'Violet',
    description: 'Format feed potret 4:5, gradien ungu–pink cerah di feed Instagram.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(180deg, #7000ff 0%, #c026d3 45%, #f472b6 100%)',
    accent: '#fdf4ff',
  },

  // ── Standar Fallback ────────────────────────────────────────────────────
  {
    key: 'default',
    label: 'Standar',
    description: 'Gradien biru–ungu khas Fess n Curious, siap pakai di feed.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(135deg, #0038ff 0%, #4b1fff 55%, #7000ff 100%)',
    accent: '#ffffff',
    category: 'standard',
  },
];

export const DEFAULT_TEMPLATE_KEY = 'default';

export function getTemplateByKey(key: string): TemplateConfig {
  return (
    TEMPLATES.find((t) => t.key === key) ||
    TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY) ||
    TEMPLATES[0]
  );
}
