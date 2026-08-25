import type { NextConfig } from 'next';

const isDevelopment = process.env.NODE_ENV === 'development';

/** 地図タイルの配信元。ここ以外への外部通信は行わない */
const TILE_ORIGIN = 'https://tile.openstreetmap.org';

/**
 * Content-Security-Policy。
 *
 * このアプリが外部と通信するのは地図タイルの取得だけで、それ以外の宛先は自オリジンに閉じる。
 * `script-src` に `unsafe-inline` が要るのは、Next.js がハイドレーション用の
 * インラインスクリプトを埋め込むため。開発時は Turbopack の HMR が eval を使う。
 * `worker-src` の `blob:` は MapLibre GL がタイル描画用のワーカーを起こすのに要る。
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `img-src 'self' data: blob: ${TILE_ORIGIN}`,
  `connect-src 'self' ${TILE_ORIGIN}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "font-src 'self' data:",
].join('; ');

/**
 * 全応答へ付ける防御的なヘッダ。
 *
 * Web Serial API は利用者の明示的な操作でしか開かないため `Permissions-Policy` では触れず、
 * このアプリが一切使わない機能だけを塞いでいる。
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
