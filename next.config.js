/** @type {import('next').NextConfig} */
// Id build: commit Git yang dideploy Vercel (tanpa itu = 'dev', pemeriksaan versi dimatikan). Dipakai server & klien untuk mendeteksi HP yang menjalankan deployment/JS lama.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7);
module.exports = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  reactStrictMode: false,
  transpilePackages: ['three'],
  // firebase-admin memakai modul native/dinamis Node: biarkan sebagai paket eksternal di sisi server (tidak di-bundle).
  experimental: { serverComponentsExternalPackages: ['firebase-admin'] },
};
