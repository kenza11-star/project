/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false,
  transpilePackages: ['three'],
  // firebase-admin memakai modul native/dinamis Node: biarkan sebagai paket eksternal di sisi server (tidak di-bundle).
  experimental: { serverComponentsExternalPackages: ['firebase-admin'] },
};
