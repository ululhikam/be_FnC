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
};

export interface TemplateConfig {
  key: string;
  label: string;
  description: string;
  aspect: string;
  ink: 'light' | 'dark';
  background: string;
  accent: string;
}

export const TEMPLATES: TemplateConfig[] = [
  {
    key: 'default',
    label: 'Standar',
    description: 'Gradien biru–ungu khas Fess n Curious, siap pakai di feed.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(135deg, #0038ff 0%, #4b1fff 55%, #7000ff 100%)',
    accent: '#ffffff',
  },
  {
    key: 'midnight',
    label: 'Tengah Malam',
    description: 'Biru tua pekat bertekstur bintang — cocok untuk curhat malam.',
    aspect: 'portrait',
    ink: 'light',
    background: 'radial-gradient(120% 90% at 20% 0%, #16204d 0%, #0a0e22 45%, #05060f 100%)',
    accent: '#7dd3fc',
  },
  {
    key: 'sunset',
    label: 'Senja',
    description: 'Oranye ke merah muda, hangat dan ramah di feed.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(160deg, #ff7a18 0%, #ff3d6e 52%, #a01fff 100%)',
    accent: '#fff4e8',
  },
  {
    key: 'forest',
    label: 'Rimba',
    description: 'Hijau teal yang menenangkan, pas untuk opini santai.',
    aspect: 'square',
    ink: 'light',
    background: 'linear-gradient(140deg, #0f766e 0%, #059669 55%, #34d399 100%)',
    accent: '#ecfdf5',
  },
  {
    key: 'noir',
    label: 'Noir',
    description: 'Hitam pekat bergrid neon — gelap, tajam, misterius.',
    aspect: 'square',
    ink: 'light',
    background: 'linear-gradient(180deg, #0b0d14 0%, #12141f 60%, #0b0d14 100%)',
    accent: '#0038ff',
  },
  {
    key: 'paper',
    label: 'Kertas',
    description: 'Krem bersih bertekstur arsir — teks gelap, enak dibaca.',
    aspect: 'portrait',
    ink: 'dark',
    background: 'linear-gradient(150deg, #fdf6ec 0%, #f6ead6 60%, #efe0c6 100%)',
    accent: '#b45309',
  },
  {
    key: 'ocean',
    label: 'Samudra',
    description: 'Cyan ke biru tua, segar seperti biru laut.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(200deg, #22d3ee 0%, #0ea5e9 48%, #1e3a8a 100%)',
    accent: '#ecfeff',
  },
  {
    key: 'violet',
    label: 'Violet',
    description: 'Format feed potret 4:5, ungu–pink cerah siap auto-post ke Instagram.',
    aspect: 'portrait',
    ink: 'light',
    background: 'linear-gradient(180deg, #7000ff 0%, #c026d3 45%, #f472b6 100%)',
    accent: '#fdf4ff',
  },
];

export function getTemplateByKey(key: string): TemplateConfig {
  return TEMPLATES.find((t) => t.key === key) || TEMPLATES[0];
}
