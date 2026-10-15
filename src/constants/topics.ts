export interface TopicItem {
  id: string;
  label: string;
  category: string;
  color: string;
}

export const TOPICS: TopicItem[] = [
  // Hidup Sehari-hari
  { id: 'cerita', label: 'Cerita', category: 'Hidup', color: '#3B82F6' },
  { id: 'pengalaman', label: 'Pengalaman', category: 'Hidup', color: '#06B6D4' },
  { id: 'renungan', label: 'Renungan', category: 'Hidup', color: '#8B5CF6' },
  { id: 'motivasi', label: 'Motivasi', category: 'Hidup', color: '#F59E0B' },
  { id: 'kecewa', label: 'Kecewa', category: 'Hidup', color: '#EF4444' },
  { id: 'bahagia', label: 'Bahagia', category: 'Hidup', color: '#22C55E' },
  { id: 'sedih', label: 'Sedih', category: 'Hidup', color: '#6366F1' },
  { id: 'marah', label: 'Marah', category: 'Hidup', color: '#F97316' },
  { id: 'cemas', label: 'Cemas', category: 'Hidup', color: '#F59E0B' },
  { id: 'lelah', label: 'Lelah', category: 'Hidup', color: '#9CA3AF' },

  // Hubungan
  { id: 'cinta', label: 'Cinta', category: 'Hubungan', color: '#EC4899' },
  { id: 'putus', label: 'Putus Cinta', category: 'Hubungan', color: '#EF4444' },
  { id: 'crush', label: 'Crush', category: 'Hubungan', color: '#F472B6' },
  { id: 'friendzone', label: 'Friendzone', category: 'Hubungan', color: '#6B7280' },
  { id: 'ldr', label: 'LDR', category: 'Hubungan', color: '#8B5CF6' },
  { id: 'pertemuan', label: 'Pertemuan', category: 'Hubungan', color: '#22C55E' },
  { id: 'perpisahan', label: 'Perpisahan', category: 'Hubungan', color: '#6366F1' },
  { id: 'komitmen', label: 'Komitmen', category: 'Hubungan', color: '#059669' },

  // Karir & Pendidikan
  { id: 'kerja', label: 'Kerja', category: 'Karir', color: '#1D4ED8' },
  { id: 'magang', label: 'Magang', category: 'Karir', color: '#059669' },
  { id: 'wawancara', label: 'Wawancara', category: 'Karir', color: '#0891B2' },
  { id: 'resign', label: 'Resign', category: 'Karir', color: '#DC2626' },
  { id: 'promosi', label: 'Promosi', category: 'Karir', color: '#16A34A' },
  { id: 'gaji', label: 'Gaji', category: 'Karir', color: '#84CC16' },
  { id: 'kuliah', label: 'Kuliah', category: 'Pendidikan', color: '#7C3AED' },
  { id: 'skripsi', label: 'Skripsi/Tesis', category: 'Pendidikan', color: '#A855F7' },
  { id: 'ujian', label: 'Ujian', category: 'Pendidikan', color: '#2563EB' },
  { id: 'beasiswa', label: 'Beasiswa', category: 'Pendidikan', color: '#F59E0B' },

  // Teknologi & Programming
  { id: 'coding', label: 'Coding', category: 'Teknologi', color: '#0D9488' },
  { id: 'debugging', label: 'Debugging', category: 'Teknologi', color: '#DC2626' },
  { id: 'deployment', label: 'Deployment', category: 'Teknologi', color: '#059669' },
  { id: 'ai', label: 'AI/ML', category: 'Teknologi', color: '#8B5CF6' },
  { id: 'startup', label: 'Startup', category: 'Teknologi', color: '#F59E0B' },
  { id: 'freelance', label: 'Freelance', category: 'Teknologi', color: '#0891B2' },
  { id: 'remote', label: 'Remote Work', category: 'Teknologi', color: '#6366F1' },
  { id: 'techstack', label: 'Tech Stack', category: 'Teknologi', color: '#EC4899' },

  // Hobi & Minat
  { id: 'gaming', label: 'Gaming', category: 'Hobi', color: '#8B5CF6' },
  { id: 'anime', label: 'Anime/Manga', category: 'Hobi', color: '#F472B6' },
  { id: 'film', label: 'Film/Series', category: 'Hobi', color: '#EC4899' },
  { id: 'musik', label: 'Musik', category: 'Hobi', color: '#F97316' },
  { id: 'baca', label: 'Membaca', category: 'Hobi', color: '#059669' },
  { id: 'olahraga', label: 'Olahraga', category: 'Hobi', color: '#EF4444' },
  { id: 'travel', label: 'Traveling', category: 'Hobi', color: '#06B6D4' },
  { id: 'kuliner', label: 'Kuliner', category: 'Hobi', color: '#F97316' },
  { id: 'foto', label: 'Fotografi', category: 'Hobi', color: '#6366F1' },
  { id: 'desain', label: 'Desain', category: 'Hobi', color: '#A855F7' },

  // Keuangan
  { id: 'tabungan', label: 'Tabungan', category: 'Keuangan', color: '#22C55E' },
  { id: 'investasi', label: 'Investasi', category: 'Keuangan', color: '#16A34A' },
  { id: 'cicilan', label: 'Cicilan/Hutang', category: 'Keuangan', color: '#EF4444' },
  { id: 'pengeluaran', label: 'Pengeluaran', category: 'Keuangan', color: '#F97316' },
  { id: 'sidehustle', label: 'Side Hustle', category: 'Keuangan', color: '#8B5CF6' },
  { id: 'krypto', label: 'Kripto', category: 'Keuangan', color: '#F59E0B' },

  // Kesehatan
  { id: 'kesehatan', label: 'Kesehatan', category: 'Kesehatan', color: '#EC4899' },
  { id: 'mental', label: 'Mental Health', category: 'Kesehatan', color: '#8B5CF6' },
  { id: 'terapi', label: 'Terapi', category: 'Kesehatan', color: '#06B6D4' },
  { id: 'obat', label: 'Obat', category: 'Kesehatan', color: '#F59E0B' },
  { id: 'diet', label: 'Diet/Nutrisi', category: 'Kesehatan', color: '#22C55E' },
  { id: 'tidur', label: 'Gangguan Tidur', category: 'Kesehatan', color: '#6366F1' },

  // Lainnya
  { id: 'random', label: 'Random', category: 'Lainnya', color: '#6B7280' },
  { id: 'tanya', label: 'Bertanya', category: 'Lainnya', color: '#06B6D4' },
  { id: 'opini', label: 'Opini', category: 'Lainnya', color: '#F59E0B' },
  { id: 'review', label: 'Review', category: 'Lainnya', color: '#F59E0B' },
  { id: 'rekomendasi', label: 'Rekomendasi', category: 'Lainnya', color: '#22C55E' },
  { id: 'kurcol', label: 'Kurcol', category: 'Lainnya', color: '#92400E' },
  { id: 'mimpi', label: 'Mimpi', category: 'Lainnya', color: '#6366F1' },
  { id: 'lucu', label: 'Lucu/Meme', category: 'Lainnya', color: '#F59E0B' },
  { id: 'horor', label: 'Horor/Misteri', category: 'Lainnya', color: '#374151' },
  { id: 'nsfw', label: 'NSFW', category: 'Lainnya', color: '#DC2626' },
];
