/**
 * ModerationService — filter NLP ringan untuk konten fess.
 * ---------------------------------------------------------------------------
 * Dipakai oleh mode "auto post" pada Base: fess langsung terbit HANYA jika
 * classifier tidak menemukan indikasi konten negatif. Pendekatan heuristik
 * berbasis leksikon (tanpa dependensi eksternal) agar cepat, deterministik,
 * dan bisa dijalankan di dalam transaksi request:
 *
 *   1. Normalisasi teks — lowercase, hapus zero-width/karakter arah, ubah
 *      leetspeak (4→a, 0→o, dst.), rapikan huruf yang diulang ("anjiiing").
 *   2. Pencocokan kata/frasa per kategori dengan bobot (word-boundary, bukan
 *      substring — "membunuh waktu" tidak menandai kata "bunuh").
 *   3. Skor total >= threshold → flagged; kategori yang cocok dikembalikan
 *      sebagai alasan (dipakai untuk label di antrean moderasi admin).
 */

export interface ModerationVerdict {
  flagged: boolean;
  score: number;
  /** Label kategori yang cocok (manusiawi), mis. ["ujaran kebencian", "ancaman"]. */
  reasons: string[];
  /** Kata/frasa yang terdeteksi, untuk transparansi log admin. */
  matches: string[];
}

interface LexiconRule {
  label: string;
  weight: number;
  terms: string[];
}

/** Bobot >= threshold langsung menandai konten. */
const FLAG_THRESHOLD = 2;

const LEXICONS: LexiconRule[] = [
  {
    label: 'ujaran kebencian',
    weight: 2,
    terms: [
      'anjing', 'babi', 'monyet', 'kunyuk', 'kampret', 'tolol', 'goblok',
      'idiot', 'bego', 'kontol', 'memek', 'ngentot', 'bajingan', 'brengsek',
      'keparat', 'asu', 'bangke', 'pukimak', 'kimak', 'sialan', 'bedebah',
      'jablay', 'pelacur', 'sundal',
    ],
  },
  {
    label: 'ancaman',
    weight: 3,
    terms: [
      'bunuh', 'bantai', 'habisi', 'bacok', 'hancurkan', 'tumpas', 'serang',
      'siksa', 'mutilasi', 'gorok', 'tabrak', 'gebuk', 'hajar',
    ],
  },
  {
    label: 'SARA',
    weight: 3,
    terms: ['jawir'],
  },
  {
    label: 'konten seksual',
    weight: 2,
    terms: ['bokep', 'telanjang', 'open bo', 'colmek', 'vcs', 'syur', 'masturbasi'],
  },
  {
    label: 'judi/spam online',
    weight: 2,
    terms: ['gacor', 'maxwin', 'judol', 'judi', 'togel', 'pinjol', 'bandar'],
  },
  {
    label: 'ajakan menyakiti diri',
    weight: 3,
    terms: ['bunuh diri', 'gantung diri', 'pengen mati', 'mau mati', 'akhiri hidup'],
  },
];

/** Peta leetspeak umum agar "4nj1ng" tetap terdeteksi. */
const LEET_MAP: Record<string, string> = {
  '4': 'a',
  '@': 'a',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '5': 's',
  '$': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
};

/** Normalisasi teks untuk pencocokan leksikon. */
function normalize(raw: string): string {
  let text = String(raw || '')
    .toLowerCase()
    // zero-width & karakter kontrol arah teks
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    // teks-teks unicode → ascii dasar (é → e, dll.)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  // leetspeak digit/simbol → huruf
  text = text.replace(/[4@31!|05$789]/g, (ch) => LEET_MAP[ch] || ch);

  // sisakan huruf + spasi saja (URL ikut larut jadi kata netral)
  text = text.replace(/[^a-z\s]/g, ' ');

  // huruf berulang 3+ kali → satu ("anjiiing" → "anjing", "goblokkk" → "goblok")
  text = text.replace(/([a-z])\1{2,}/g, '$1');

  return text.replace(/\s+/g, ' ').trim();
}

export class ModerationService {
  /**
   * Klasifikasi konten fess. Mobile/back-end memakai hasil `flagged` untuk
   * memutuskan auto publish vs masuk antrean moderasi.
   *
   * @param bannedWords daftar kata terlarang milik base (blacklist admin).
   *   Satu kata terlarang yang muncul (word-boundary, tahan leetspeak) sudah
   *   cukup untuk menandai konten.
   */
  static classify(content: string, bannedWords: string[] = []): ModerationVerdict {
    const normalized = normalize(content);
    const padded = ` ${normalized} `;

    const reasons: string[] = [];
    const matches: string[] = [];
    let score = 0;

    // 0) Blacklist kata base — prioritas tertinggi, langsung flag (bobot penuh).
    for (const raw of bannedWords) {
      const word = normalize(raw);
      if (!word) continue;
      if (!padded.includes(` ${word} `)) continue;
      score += FLAG_THRESHOLD;
      if (!reasons.includes('kata terlarang')) reasons.push('kata terlarang');
      if (!matches.includes(String(raw).trim()) && matches.length < 5) {
        matches.push(String(raw).trim());
      }
    }

    for (const rule of LEXICONS) {
      const hit = rule.terms.find((term) => padded.includes(` ${term} `));
      if (!hit) continue;
      score += rule.weight;
      if (!reasons.includes(rule.label)) reasons.push(rule.label);
      if (!matches.includes(hit) && matches.length < 5) matches.push(hit);
    }

    // Spam link masif (>= 3 tautan) — indikasi promosi/penipuan.
    const linkCount = (String(content || '').match(/https?:\/\/|www\./gi) || []).length;
    if (linkCount >= 3) {
      score += 2;
      if (!reasons.includes('spam link')) reasons.push('spam link');
    }

    return {
      flagged: score >= FLAG_THRESHOLD,
      score,
      reasons,
      matches,
    };
  }
}
