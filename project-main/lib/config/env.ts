// Konfigurasi PUBLIK (aman di browser). Semua nilai berasal dari NEXT_PUBLIC_* yang kamu isi di Vercel.
// Next.js hanya menyisipkan variabel yang ditulis LITERAL seperti di bawah, jadi jangan diubah menjadi akses dinamis.
// Tidak ada rahasia di file ini. Rahasia (Firebase Admin, Supabase service role) hanya ada di lib/server/*.
export const publicEnv = {
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  },
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  netSendHz: Number(process.env.NEXT_PUBLIC_NET_SEND_HZ || '') || 0,
};

/** true bila 4 variabel Firebase klien terisi. Belum tentu VALID: validitas baru terbukti saat login sungguhan. */
export const firebaseClientConfigured = () => { const f = publicEnv.firebase; return !!(f.apiKey && f.authDomain && f.projectId && f.appId); };
export const supabaseClientConfigured = () => !!(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
/** Multiplayer online butuh kedua layanan terisi di klien (server juga harus terisi; lihat GET /api/status). */
export const onlineConfigured = () => firebaseClientConfigured() && supabaseClientConfigured();
