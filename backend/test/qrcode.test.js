import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { organizationQuestionnaireUrl, qrPng } from '../src/qrcode.js';
import { verifyOrganizationQrToken } from '../src/qr-token.js';

test('generated QR PNG contains dark modules inside the scan area', async () => {
  const tokenSecret = randomBytes(32).toString('base64url');
  const png = await qrPng('DEFAULT', '虚构测试机构', 300, {
    tokenSecret,
    baseUrl: 'https://survey.example.test'
  });
  const { data, info } = await sharp(png)
    .extract({ left: 50, top: 54, width: 200, height: 200 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let darkPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index] < 40 && data[index + 1] < 40 && data[index + 2] < 40) darkPixels += 1;
  }
  assert.equal(info.width, 200);
  assert.equal(info.height, 200);
  assert.ok(darkPixels > 1000, `expected QR modules in scan area, received ${darkPixels} dark pixels`);
});

test('organization QR URL contains a signed token instead of an editable org parameter', () => {
  const tokenSecret = randomBytes(32).toString('base64url');
  const url = new URL(organizationQuestionnaireUrl('DEFAULT', {
    tokenSecret,
    baseUrl: 'https://survey.example.test/'
  }));

  assert.equal(url.origin, 'https://survey.example.test');
  assert.equal(url.pathname, '/q');
  assert.equal(url.searchParams.has('org'), false);
  assert.deepEqual(verifyOrganizationQrToken(url.searchParams.get('qr'), tokenSecret), {
    orgCode: 'DEFAULT',
    questionnaireVersion: 'v2'
  });
});
