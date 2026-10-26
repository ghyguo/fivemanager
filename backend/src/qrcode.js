import QRCode from 'qrcode';
import sharp from 'sharp';
import { signOrganizationQrToken } from './qr-token.js';

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  })[char]);
}

export function organizationQuestionnaireUrl(code, {
  baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost',
  tokenSecret = process.env.QR_TOKEN_SECRET
} = {}) {
  const token = signOrganizationQrToken(code, tokenSecret);
  return `${baseUrl.replace(/\/+$/, '')}/q?qr=${encodeURIComponent(token)}`;
}

export async function qrPng(code, name, size, options) {
  const qrSize = size - 100;
  const url = organizationQuestionnaireUrl(code, options);
  const qr = await QRCode.toBuffer(url, { type: 'png', width: qrSize, margin: 1, errorCorrectionLevel: 'M' });
  const label = escapeXml(name.length > 22 ? `${name.slice(0, 21)}…` : name);
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fff"/>
      <text x="50%" y="38" text-anchor="middle" font-size="24" font-family="Noto Sans CJK SC, sans-serif" fill="#111">${label}</text>
      <text x="50%" y="${size - 22}" text-anchor="middle" font-size="16" font-family="Noto Sans CJK SC, sans-serif" fill="#333">微信扫一扫，填写健康问卷</text>
    </svg>`
  );
  return sharp({ create: { width: size, height: size, channels: 4, background: '#fff' } })
    .composite([
      { input: svg, left: 0, top: 0 },
      { input: qr, left: Math.floor((size - qrSize) / 2), top: 54 }
    ])
    .png()
    .toBuffer();
}
