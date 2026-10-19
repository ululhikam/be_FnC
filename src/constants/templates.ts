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

export type TemplateFontFamily = 'sans' | 'display' | 'serif' | 'mono';

export interface TemplateTypography {
  /** Keluarga font: sans (Poppins), display (Bebas Neue), serif (DM Serif), mono (Fira Mono). */
  family: TemplateFontFamily;
  /** Weight font. Keluarga display/serif hanya punya weight 400. */
  weight: number;
  /** Apakah isi fess diubah ke huruf kapital. */
  uppercase: boolean;
  /** Perataan isi fess di dalam kartu. */
  align: 'left' | 'center';
  /** Jarak antar huruf dalam em (0.01 = 1% ukuran font). */
  letterSpacing: number;
  /** Pengali tinggi baris. */
  lineHeight: number;
  /** Pengali ukuran font dasar renderer. */
  scale: number;
}

export interface TemplatePanel {
  bg: string;
  border: string;
  width?: number;
  radius?: number;
  /** Pola stroke putus-putus SVG, mis. "8 6". */
  dash?: string;
  /** Jenis bayangan kartu. */
  shadow?: 'soft' | 'hard' | 'none';
}

export interface TemplateConfig {
  key: string;
  label: string;
  description: string;
  aspect: string;
  ink: 'light' | 'dark';
  background: string;
  accent: string;
  typography?: Partial<TemplateTypography>;
  panel?: TemplatePanel;
  /** Definisi <pattern> khusus template (tanpa wrapper <defs>). */
  pattern?: string;
  /** Override warna teks (untuk template terang dengan tinta gelap). */
  textColor?: string;
  subtextColor?: string;
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
    typography: {
      family: 'mono',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.01,
      lineHeight: 1.5,
      scale: 0.95,
    },
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
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.18,
      scale: 1.08,
    },
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
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.02,
      lineHeight: 1.2,
      scale: 1.08,
    },
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
    typography: {
      family: 'mono',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.95,
    },
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
    typography: {
      family: 'sans',
      weight: 600,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.45,
      scale: 1,
    },
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
    typography: {
      family: 'sans',
      weight: 500,
      uppercase: false,
      align: 'left',
      letterSpacing: -0.005,
      lineHeight: 1.4,
      scale: 1,
    },
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
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.015,
      lineHeight: 1.25,
      scale: 1.05,
    },
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
    typography: {
      family: 'sans',
      weight: 700,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.02,
      lineHeight: 1.35,
      scale: 1,
    },
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
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.5,
      scale: 1,
    },
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
    typography: {
      family: 'mono',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.01,
      lineHeight: 1.5,
      scale: 0.92,
    },
  },

  // ── 11. LEGACY: Tengah Malam ────────────────────────────────────────────
  {
    key: 'midnight',
    label: 'Tengah Malam',
    description: 'Biru tua pekat — cocok untuk curhat malam.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0a0e27',
    accent: '#7dd3fc',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.98,
    },
  },

  // ── 12. LEGACY: Senja ───────────────────────────────────────────────────
  {
    key: 'sunset',
    label: 'Senja',
    description: 'Merah rose hangat dan ramah di feed.',
    aspect: 'portrait',
    ink: 'light',
    background: '#e11d48',
    accent: '#fff4e8',
    typography: {
      family: 'sans',
      weight: 600,
      uppercase: false,
      align: 'center',
      letterSpacing: 0,
      lineHeight: 1.45,
      scale: 1,
    },
  },

  // ── 13. LEGACY: Rimba ───────────────────────────────────────────────────
  {
    key: 'forest',
    label: 'Rimba',
    description: 'Hijau emerald yang menenangkan, pas untuk opini santai.',
    aspect: 'square',
    ink: 'light',
    background: '#065f46',
    accent: '#ecfdf5',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.5,
      scale: 0.98,
    },
  },

  // ── 14. LEGACY: Noir ────────────────────────────────────────────────────
  {
    key: 'noir',
    label: 'Noir',
    description: 'Hitam pekat bergrid neon — gelap, tajam, misterius.',
    aspect: 'square',
    ink: 'light',
    background: '#0b0d14',
    accent: '#0038ff',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.02,
      lineHeight: 1.4,
      scale: 1,
    },
  },

  // ── 15. LEGACY: Kertas ──────────────────────────────────────────────────
  {
    key: 'paper',
    label: 'Kertas',
    description: 'Krem bersih bertekstur arsir — teks gelap, enak dibaca.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#f5ede0',
    accent: '#b45309',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.98,
    },
  },

  // ── 16. LEGACY: Samudra ─────────────────────────────────────────────────
  {
    key: 'ocean',
    label: 'Samudra',
    description: 'Biru laut dalam, segar dan tenang.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0369a1',
    accent: '#ecfeff',
    typography: {
      family: 'sans',
      weight: 500,
      uppercase: false,
      align: 'center',
      letterSpacing: 0,
      lineHeight: 1.5,
      scale: 1,
    },
  },

  // ── 17. LEGACY: Violet ──────────────────────────────────────────────────
  {
    key: 'violet',
    label: 'Violet',
    description: 'Ungu cerah yang menonjol di feed Instagram.',
    aspect: 'portrait',
    ink: 'light',
    background: '#7c3aed',
    accent: '#fdf4ff',
    typography: {
      family: 'sans',
      weight: 600,
      uppercase: false,
      align: 'center',
      letterSpacing: 0,
      lineHeight: 1.45,
      scale: 1,
    },
  },

  // ── 18. Standar Fallback ────────────────────────────────────────────────
  {
    key: 'default',
    label: 'Standar',
    description: 'Biru khas Fess n Curious, siap pakai di feed.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0038ff',
    accent: '#ffffff',
    typography: {
      family: 'sans',
      weight: 600,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.42,
      scale: 1,
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // 20 TEMPLATE BARU — variasi bentuk, warna, dan format teks.
  // ════════════════════════════════════════════════════════════════════════

  // ── 19. RETRO: Sunburst 70s ─────────────────────────────────────────────
  {
    key: 'sunburst',
    label: 'Sunburst 70s',
    description: 'Retro 70an — mustard hangat dengan burst matahari dan tipografi poster.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#f2b705',
    accent: '#d64309',
    textColor: '#3b1d0a',
    subtextColor: 'rgba(59,29,10,0.68)',
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.01,
      lineHeight: 1.22,
      scale: 1.08,
    },
    panel: { bg: '#fff8e1', border: '#d64309', width: 2, radius: 28, shadow: 'soft' },
    pattern: `<pattern id="bgPattern" width="96" height="96" patternUnits="userSpaceOnUse">
        <circle cx="48" cy="48" r="30" fill="none" stroke="rgba(214,67,9,0.16)" stroke-width="2"/>
        <circle cx="48" cy="48" r="18" fill="none" stroke="rgba(214,67,9,0.16)" stroke-width="2"/>
        <path d="M48 6v84 M6 48h84 M18 18l60 60 M78 18L18 78" stroke="rgba(214,67,9,0.12)" stroke-width="2"/>
      </pattern>`,
  },

  // ── 20. EDITORIAL: Koran ────────────────────────────────────────────────
  {
    key: 'newsprint',
    label: 'Koran',
    description: 'Editorial koran klasik — kertas krem, garis kolom, dan serif yang tegas.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#f3efe4',
    accent: '#111827',
    textColor: '#1c1917',
    subtextColor: 'rgba(28,25,23,0.62)',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 1,
    },
    panel: {
      bg: 'rgba(255,255,255,0.55)',
      border: 'rgba(17,24,39,0.30)',
      width: 2,
      radius: 8,
      shadow: 'none',
    },
    pattern: `<pattern id="bgPattern" width="60" height="40" patternUnits="userSpaceOnUse">
        <path d="M0 0v40" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>
        <path d="M8 8h20 M8 14h30 M8 20h16 M8 26h26" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
      </pattern>`,
  },

  // ── 21. POSTER: Poster Merah ────────────────────────────────────────────
  {
    key: 'poster',
    label: 'Poster Merah',
    description: 'Poster konser tegas — hitam pekat, aksen merah menyala, teks kapital besar.',
    aspect: 'square',
    ink: 'light',
    background: '#111111',
    accent: '#ff2d2d',
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.015,
      lineHeight: 1.12,
      scale: 1.15,
    },
    panel: { bg: '#181818', border: '#ff2d2d', width: 3, radius: 10, shadow: 'none' },
    pattern: `<pattern id="bgPattern" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="11" cy="11" r="3" fill="rgba(255,45,45,0.16)"/>
      </pattern>`,
  },

  // ── 22. GAME: Arcade ────────────────────────────────────────────────────
  {
    key: 'arcade',
    label: 'Arcade',
    description: 'Game arcade 8-bit — ungu malam, piksel neon, dan teks monospace.',
    aspect: 'square',
    ink: 'light',
    background: '#120a2e',
    accent: '#ff2ec4',
    typography: {
      family: 'mono',
      weight: 700,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.02,
      lineHeight: 1.45,
      scale: 0.92,
    },
    panel: { bg: 'rgba(18,10,46,0.92)', border: '#00e5ff', width: 2, radius: 8, shadow: 'soft' },
    pattern: `<pattern id="bgPattern" width="32" height="32" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="6" height="6" fill="rgba(255,46,196,0.18)"/>
        <rect x="16" y="16" width="6" height="6" fill="rgba(0,229,255,0.14)"/>
        <path d="M32 0H0v32" stroke="rgba(0,229,255,0.10)" stroke-width="1"/>
      </pattern>`,
  },

  // ── 23. POP: Memphis 80s ────────────────────────────────────────────────
  {
    key: 'memphis',
    label: 'Memphis 80s',
    description: 'Memphis colorful — krem ceria dengan squiggle, segitiga, dan bentuk playful.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#fdf6e3',
    accent: '#ff6b6b',
    textColor: '#1f2937',
    subtextColor: 'rgba(31,41,55,0.65)',
    typography: {
      family: 'sans',
      weight: 700,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.42,
      scale: 1,
    },
    panel: { bg: '#ffffff', border: '#1f2937', width: 3, radius: 20, shadow: 'hard' },
    pattern: `<pattern id="bgPattern" width="80" height="80" patternUnits="userSpaceOnUse">
        <path d="M8 20q8-12 16 0t16 0" fill="none" stroke="rgba(13,148,136,0.35)" stroke-width="3"/>
        <circle cx="60" cy="16" r="4" fill="rgba(255,107,107,0.4)"/>
        <path d="M56 52l10 16H46z" fill="none" stroke="rgba(234,179,8,0.5)" stroke-width="3"/>
        <circle cx="20" cy="62" r="3" fill="rgba(59,130,246,0.35)"/>
      </pattern>`,
  },

  // ── 24. ORGANIC: Botanical ──────────────────────────────────────────────
  {
    key: 'botanical',
    label: 'Botanical',
    description: 'Botani elegan — hijau hutan dalam dengan garis daun dan serif klasik.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0f3d2e',
    accent: '#d4e157',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.98,
    },
    panel: {
      bg: 'rgba(255,255,255,0.06)',
      border: 'rgba(212,225,87,0.50)',
      width: 1.5,
      radius: 32,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="64" height="64" patternUnits="userSpaceOnUse">
        <path d="M12 52q20-40 40-40 M20 52q12-28 32-32" fill="none" stroke="rgba(212,225,87,0.22)" stroke-width="1.5"/>
        <circle cx="50" cy="14" r="3" fill="rgba(212,225,87,0.25)"/>
      </pattern>`,
  },

  // ── 25. SOFT: Coquette ──────────────────────────────────────────────────
  {
    key: 'coquette',
    label: 'Coquette',
    description: 'Soft girl aesthetic — blush pink, pita kecil, dan serif yang lembut.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#f7d6df',
    accent: '#9d174d',
    textColor: '#4a1026',
    subtextColor: 'rgba(74,16,38,0.65)',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'center',
      letterSpacing: 0.01,
      lineHeight: 1.55,
      scale: 0.96,
    },
    panel: {
      bg: 'rgba(255,255,255,0.68)',
      border: 'rgba(157,23,77,0.35)',
      width: 1.5,
      radius: 28,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M24 18c-4-6-12-4-10 2 1 4 7 5 10 2 3 3 9 2 10-2 2-6-6-8-10-2z" fill="none" stroke="rgba(157,23,77,0.22)" stroke-width="1.5"/>
        <circle cx="10" cy="36" r="1.6" fill="rgba(157,23,77,0.25)"/>
        <circle cx="38" cy="10" r="1.2" fill="rgba(157,23,77,0.20)"/>
      </pattern>`,
  },

  // ── 26. STREET: Graffiti ────────────────────────────────────────────────
  {
    key: 'graffiti',
    label: 'Graffiti',
    description: 'Street art — beton terang, drip cat oranye, dan tipografi poster berani.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#d4d4d8',
    accent: '#ff3d00',
    textColor: '#18181b',
    subtextColor: 'rgba(24,24,27,0.68)',
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.01,
      lineHeight: 1.2,
      scale: 1.06,
    },
    panel: { bg: '#18181b', border: '#ff3d00', width: 3, radius: 6, shadow: 'hard' },
    pattern: `<pattern id="bgPattern" width="56" height="56" patternUnits="userSpaceOnUse">
        <path d="M4 8c8 2 10 14 4 22M28 4v18M40 30c6 2 8 10 2 16" stroke="rgba(255,61,0,0.35)" stroke-width="3" stroke-linecap="round" fill="none"/>
        <circle cx="18" cy="42" r="2" fill="rgba(255,61,0,0.30)"/>
        <circle cx="48" cy="12" r="1.5" fill="rgba(0,0,0,0.20)"/>
      </pattern>`,
  },

  // ── 27. TRAVEL: Postcard ────────────────────────────────────────────────
  {
    key: 'postcard',
    label: 'Postcard',
    description: 'Kartu pos — langit biru, ombak santai, dan nuansa surat perjalanan.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#a5d8ff',
    accent: '#e8590c',
    textColor: '#1e3a5f',
    subtextColor: 'rgba(30,58,95,0.65)',
    typography: {
      family: 'sans',
      weight: 500,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.98,
    },
    panel: {
      bg: '#fffdf5',
      border: '#c2410c',
      width: 2,
      radius: 14,
      dash: '8 6',
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="72" height="36" patternUnits="userSpaceOnUse">
        <path d="M0 24q9-10 18 0t18 0 18 0 18 0" fill="none" stroke="rgba(30,64,175,0.25)" stroke-width="2"/>
        <circle cx="62" cy="8" r="4" fill="rgba(232,89,12,0.30)"/>
      </pattern>`,
  },

  // ── 28. NIGHT: Nightclub ────────────────────────────────────────────────
  {
    key: 'nightclub',
    label: 'Nightclub',
    description: 'Club malam — hitam neon, barcode cyan, dan tipografi teknis tajam.',
    aspect: 'portrait',
    ink: 'light',
    background: '#05060f',
    accent: '#00d1ff',
    typography: {
      family: 'mono',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.03,
      lineHeight: 1.5,
      scale: 0.93,
    },
    panel: {
      bg: 'rgba(13,16,32,0.92)',
      border: 'rgba(0,209,255,0.50)',
      width: 2,
      radius: 0,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="40" height="24" patternUnits="userSpaceOnUse">
        <path d="M4 0v24M8 0v24M10 0v24M16 0v24M22 0v24M25 0v24M31 0v24M36 0v24" stroke="rgba(0,209,255,0.16)" stroke-width="1.5"/>
      </pattern>`,
  },

  // ── 29. WARM: Sunrise ───────────────────────────────────────────────────
  {
    key: 'sunrise',
    label: 'Sunrise',
    description: 'Sunrise hangat — oranye coral, lingkaran matahari, dan headline kapital.',
    aspect: 'square',
    ink: 'dark',
    background: '#f97316',
    accent: '#fff7ed',
    textColor: '#431407',
    subtextColor: 'rgba(67,20,7,0.70)',
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'center',
      letterSpacing: 0,
      lineHeight: 1.18,
      scale: 1.1,
    },
    panel: {
      bg: 'rgba(124,45,18,0.35)',
      border: 'rgba(255,247,237,0.50)',
      width: 2,
      radius: 32,
      shadow: 'none',
    },
    pattern: `<pattern id="bgPattern" width="100" height="100" patternUnits="userSpaceOnUse">
        <g fill="none" stroke="rgba(255,247,237,0.22)" stroke-width="2">
          <circle cx="50" cy="50" r="18"/>
          <circle cx="50" cy="50" r="30"/>
          <circle cx="50" cy="50" r="42"/>
        </g>
      </pattern>`,
  },

  // ── 30. MINIMAL: Grid Minimal ───────────────────────────────────────────
  {
    key: 'minimalgrid',
    label: 'Grid Minimal',
    description: 'Minimalis tenang — abu hangat, grid tipis, dan ruang putih yang lapang.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#e7e5e4',
    accent: '#2563eb',
    textColor: '#1c1917',
    subtextColor: 'rgba(28,25,23,0.62)',
    typography: {
      family: 'sans',
      weight: 500,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.6,
      scale: 0.98,
    },
    panel: {
      bg: '#fafaf9',
      border: 'rgba(0,0,0,0.12)',
      width: 1.5,
      radius: 4,
      shadow: 'none',
    },
    pattern: `<pattern id="bgPattern" width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M36 0H0v36" fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="1"/>
      </pattern>`,
  },

  // ── 31. COMIC: Comic Zine ───────────────────────────────────────────────
  {
    key: 'comiczine',
    label: 'Comic Zine',
    description: 'Zine komik — kuning cerah, halftone, dan headline ekspresif.',
    aspect: 'square',
    ink: 'dark',
    background: '#fde68a',
    accent: '#111827',
    typography: {
      family: 'display',
      weight: 400,
      uppercase: true,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.18,
      scale: 1.06,
    },
    panel: { bg: '#ffffff', border: '#111827', width: 4, radius: 4, shadow: 'hard' },
    pattern: `<pattern id="bgPattern" width="18" height="18" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="2" fill="rgba(17,24,39,0.16)"/>
        <circle cx="13" cy="13" r="2" fill="rgba(17,24,39,0.16)"/>
      </pattern>`,
  },

  // ── 32. METALLIC: Blue Chrome ───────────────────────────────────────────
  {
    key: 'bluechrome',
    label: 'Blue Chrome',
    description: 'Chrome futuristik — biru malam, garis metalik, dan teks kapital berjarak.',
    aspect: 'portrait',
    ink: 'light',
    background: '#0f172a',
    accent: '#93c5fd',
    typography: {
      family: 'sans',
      weight: 600,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.04,
      lineHeight: 1.35,
      scale: 1,
    },
    panel: {
      bg: 'rgba(30,41,59,0.88)',
      border: 'rgba(147,197,253,0.50)',
      width: 2,
      radius: 18,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M-6 6L6-6M0 24L24 0M18 30L30 18" stroke="rgba(147,197,253,0.22)" stroke-width="2"/>
      </pattern>`,
  },

  // ── 33. INDUSTRIAL: Railway ─────────────────────────────────────────────
  {
    key: 'railway',
    label: 'Railway',
    description: 'Industrial — abu beton, garis hazard oranye, dan label monospace tegas.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#e5e5e5',
    accent: '#ea580c',
    textColor: '#1c1917',
    subtextColor: 'rgba(28,25,23,0.62)',
    typography: {
      family: 'mono',
      weight: 700,
      uppercase: true,
      align: 'left',
      letterSpacing: 0.01,
      lineHeight: 1.45,
      scale: 0.92,
    },
    panel: { bg: '#fafafa', border: '#1c1917', width: 3, radius: 0, shadow: 'none' },
    pattern: `<pattern id="bgPattern" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M-10 10L10-10M10 50L50 10" stroke="rgba(234,88,12,0.14)" stroke-width="8"/>
      </pattern>`,
  },

  // ── 34. EARTH: Terracotta ───────────────────────────────────────────────
  {
    key: 'terracotta',
    label: 'Terracotta',
    description: 'Tanah liat — terracotta hangat dengan lengkungan arsitektural dan serif.',
    aspect: 'portrait',
    ink: 'light',
    background: '#c2410c',
    accent: '#fed7aa',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.5,
      scale: 1,
    },
    panel: {
      bg: 'rgba(67,20,7,0.42)',
      border: 'rgba(254,215,170,0.45)',
      width: 2,
      radius: 40,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="90" height="90" patternUnits="userSpaceOnUse">
        <path d="M15 85V55a30 30 0 0 1 60 0v30" fill="none" stroke="rgba(254,215,170,0.20)" stroke-width="2"/>
        <path d="M30 85V60a15 15 0 0 1 30 0v25" fill="none" stroke="rgba(254,215,170,0.16)" stroke-width="1.5"/>
      </pattern>`,
  },

  // ── 35. DREAMY: Hologram ────────────────────────────────────────────────
  {
    key: 'hologram',
    label: 'Hologram',
    description: 'Holografik dreamy — teal gelap dengan kilau permata dan teks mengambang.',
    aspect: 'square',
    ink: 'light',
    background: '#042f2e',
    accent: '#5eead4',
    typography: {
      family: 'sans',
      weight: 500,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.98,
    },
    panel: {
      bg: 'rgba(4,47,46,0.85)',
      border: 'rgba(94,234,212,0.50)',
      width: 2,
      radius: 24,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="56" height="56" patternUnits="userSpaceOnUse">
        <path d="M28 6l22 22-22 22L6 28z" fill="none" stroke="rgba(94,234,212,0.14)" stroke-width="1.5"/>
        <rect x="38" y="4" width="8" height="8" fill="rgba(244,114,182,0.14)" transform="rotate(45 42 8)"/>
        <rect x="6" y="40" width="7" height="7" fill="rgba(147,197,253,0.14)" transform="rotate(45 9.5 43.5)"/>
      </pattern>`,
  },

  // ── 36. PRINT: Zine Riso ────────────────────────────────────────────────
  {
    key: 'zine',
    label: 'Zine Riso',
    description: 'Cetak riso — krem zine, coretan tinta, dan monospace yang eksperimental.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#fef3c7',
    accent: '#be123c',
    textColor: '#3f1d24',
    subtextColor: 'rgba(63,29,36,0.65)',
    typography: {
      family: 'mono',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.94,
    },
    panel: {
      bg: 'rgba(255,255,255,0.60)',
      border: '#be123c',
      width: 2,
      radius: 2,
      dash: '6 5',
      shadow: 'none',
    },
    pattern: `<pattern id="bgPattern" width="64" height="64" patternUnits="userSpaceOnUse">
        <path d="M8 18l12 8M46 12l8 12M20 46l10-6" stroke="rgba(190,18,60,0.22)" stroke-width="2"/>
        <circle cx="52" cy="52" r="2" fill="rgba(29,78,216,0.20)"/>
        <circle cx="14" cy="36" r="1.5" fill="rgba(190,18,60,0.25)"/>
      </pattern>`,
  },

  // ── 37. CINEMA: Noir Film ───────────────────────────────────────────────
  {
    key: 'noirfilm',
    label: 'Noir Film',
    description: 'Sinema hitam-putih — perforasi film, tekstur grain, dan serif dramatis.',
    aspect: 'portrait',
    ink: 'light',
    background: '#000000',
    accent: '#e5e5e5',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: true,
      align: 'center',
      letterSpacing: 0.03,
      lineHeight: 1.5,
      scale: 1,
    },
    panel: {
      bg: 'rgba(255,255,255,0.04)',
      border: 'rgba(255,255,255,0.35)',
      width: 1.5,
      radius: 0,
      shadow: 'none',
    },
    pattern: `<pattern id="bgPattern" width="80" height="40" patternUnits="userSpaceOnUse">
        <rect x="4" y="6" width="6" height="8" rx="1" fill="rgba(255,255,255,0.12)"/>
        <rect x="4" y="26" width="6" height="8" rx="1" fill="rgba(255,255,255,0.12)"/>
        <path d="M30 0v40M68 0v40" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      </pattern>`,
  },

  // ── 38. ORGANIC: Meadow ─────────────────────────────────────────────────
  {
    key: 'meadow',
    label: 'Meadow',
    description: 'Padang rumput — hijau mint lembut dengan bunga kecil dan serif hangat.',
    aspect: 'portrait',
    ink: 'dark',
    background: '#dcfce7',
    accent: '#15803d',
    textColor: '#14532d',
    subtextColor: 'rgba(20,83,45,0.65)',
    typography: {
      family: 'serif',
      weight: 400,
      uppercase: false,
      align: 'left',
      letterSpacing: 0,
      lineHeight: 1.55,
      scale: 0.98,
    },
    panel: {
      bg: '#f0fdf4',
      border: 'rgba(21,128,61,0.35)',
      width: 1.5,
      radius: 28,
      shadow: 'soft',
    },
    pattern: `<pattern id="bgPattern" width="70" height="70" patternUnits="userSpaceOnUse">
        <path d="M10 60V42M10 48l-5-6M10 46l5-7M28 64V50M28 56l-4-5" stroke="rgba(21,128,61,0.28)" stroke-width="1.5"/>
        <circle cx="48" cy="22" r="3" fill="rgba(21,128,61,0.28)"/>
        <circle cx="48" cy="22" r="7" fill="none" stroke="rgba(21,128,61,0.18)" stroke-width="1"/>
        <circle cx="58" cy="54" r="2" fill="rgba(21,128,61,0.24)"/>
      </pattern>`,
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
