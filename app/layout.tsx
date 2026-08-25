import type { Metadata } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import './map.css';

const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';
const socialImage = new URL('/og.png', siteOrigin).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'Takion CLAS / RTK Web Monitor — 測位モニター',
  description: 'TakionCM001等のUSBシリアル出力をChromeで読み取り、みちびきCLAS測位およびネットワークRTK測位の情報とUBX・NMEA・RTCMログを表示するウェブアプリです。',
  openGraph: {
    title: 'Takion CLAS / RTK Web Monitor — 測位モニター',
    description: 'TakionCM001等のUSBシリアル出力をChromeで読み取り、CLASおよびネットワークRTK測位をリアルタイムに表示するWebモニターです。',
    type: 'website',
    locale: 'ja_JP',
    images: [{ url: socialImage, width: 1728, height: 912, alt: 'Takion CLAS / RTK Web Monitor' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Takion CLAS / RTK Web Monitor — 測位モニター',
    description: 'TakionCM001等の測位情報と受信ログをChromeでリアルタイム表示します。',
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
