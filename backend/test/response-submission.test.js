import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { questionnaire } from '../src/questionnaire.js';
import { signOrganizationQrToken } from '../src/qr-token.js';
import { submitSurveyResponse } from '../src/response-submission.js';

const qrTokenSecret = randomBytes(32).toString('base64url');

class InMemoryTestDatabase {
  constructor() {
    this.organizations = new Map([
      ['DEFAULT', { org_code: 'DEFAULT', org_name: '虚构测试机构', status: 1 }],
      ['OTHER', { org_code: 'OTHER', org_name: '另一家虚构机构', status: 1 }]
    ]);
    this.responsesByToken = new Map();
  }

  async execute(statement, values) {
    await Promise.resolve();
    if (statement.includes('FROM survey_response WHERE submit_token = ?')) {
      const response = this.responsesByToken.get(values[0]);
      return [response ? [{ ...response }] : []];
    }
    if (statement.includes('FROM survey_org WHERE org_code = ? AND status = 1')) {
      const org = this.organizations.get(values[0]);
      return [org?.status === 1 ? [{ ...org }] : []];
    }
    if (statement.includes('INSERT INTO survey_response')) {
      const [responseNo, submitToken, questionnaireVersion, , orgCode, orgName] = values;
      if (this.responsesByToken.has(submitToken) ||
          [...this.responsesByToken.values()].some((row) => row.response_no === responseNo)) {
        throw Object.assign(new Error('duplicate key'), { code: 'ER_DUP_ENTRY' });
      }
      this.responsesByToken.set(submitToken, {
        response_no: responseNo,
        submit_token: submitToken,
        questionnaire_version: questionnaireVersion,
        org_code: orgCode,
        org_name: orgName,
        submitted_at: values[28]
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error('Unexpected SQL in test database');
  }
}

function validSubmission(overrides = {}) {
  return {
    submitToken: 'b3d5c0de-8c1e-4f7a-9d2e-1f6a0c9e7a11',
    qrToken: signOrganizationQrToken('DEFAULT', qrTokenSecret),
    questionnaireVersion: questionnaire.version,
    privacyVersion: questionnaire.privacy.version,
    consent: true,
    fillerType: 1,
    fillerRelation: null,
    fontLevel: 'LARGE',
    startedAt: Date.now(),
    answers: {
      patient_name: '虚构测试患者', gender: 'M', age: 40, phone: '13800000000',
      height_cm: 170, weight_kg: 70, bp_status: 'NORMAL', glucose_status: 'NORMAL',
      lipid_status: 'NORMAL', salt_status: 'OK', smoking_status: 'NON_SMOKER',
      exercise_status: 'OK', family_cvd: 'N', has_cvd: 'N', has_cerebro: 'N', has_chronic: 'N'
    },
    ...overrides
  };
}

function submit(pool, body) {
  return submitSurveyResponse({
    pool,
    body,
    qrTokenSecret,
    clientIp: '192.0.2.10',
    userAgent: 'Automated test'
  });
}

test('valid organization token saves the answer under the token organization', async () => {
  const database = new InMemoryTestDatabase();
  const result = await submit(database, validSubmission());

  assert.equal(result.status, 200);
  assert.equal(database.responsesByToken.size, 1);
  assert.equal(database.responsesByToken.values().next().value.org_code, 'DEFAULT');
  assert.equal(database.responsesByToken.values().next().value.org_name, '虚构测试机构');
});

test('tampered organization token is rejected without saving a response', async () => {
  const database = new InMemoryTestDatabase();
  const token = signOrganizationQrToken('DEFAULT', qrTokenSecret);
  const [header, encodedPayload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  claims.orgCode = 'OTHER';
  const tamperedToken = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
  const result = await submit(database, validSubmission({ qrToken: tamperedToken }));

  assert.equal(result.status, 400);
  assert.equal(database.responsesByToken.size, 0);
});

test('request organization cannot disagree with the signed organization', async () => {
  const database = new InMemoryTestDatabase();
  const result = await submit(database, validSubmission({ org: 'OTHER' }));

  assert.equal(result.status, 400);
  assert.equal(database.responsesByToken.size, 0);
});

test('retrying the same submit token returns the original record without inserting again', async () => {
  const database = new InMemoryTestDatabase();
  const body = validSubmission();
  const first = await submit(database, body);
  const retry = await submit(database, body);

  assert.equal(retry.status, 200);
  assert.equal(retry.payload.data.responseNo, first.payload.data.responseNo);
  assert.equal(database.responsesByToken.size, 1);
});

test('simultaneous requests with the same submit token insert only one record', async () => {
  const database = new InMemoryTestDatabase();
  const body = validSubmission();
  const [first, second] = await Promise.all([
    submit(database, body),
    submit(database, body)
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.payload.data.responseNo, second.payload.data.responseNo);
  assert.equal(database.responsesByToken.size, 1);
});

test('a validly signed token for an unknown organization is rejected', async () => {
  const database = new InMemoryTestDatabase();
  const unknownOrganizationToken = signOrganizationQrToken('UNKNOWN', qrTokenSecret);
  const result = await submit(database, validSubmission({ qrToken: unknownOrganizationToken }));

  assert.equal(result.status, 404);
  assert.equal(database.responsesByToken.size, 0);
});

test('a previously used submit token cannot be replayed for another organization', async () => {
  const database = new InMemoryTestDatabase();
  const body = validSubmission();
  await submit(database, body);
  const replay = await submit(database, validSubmission({
    qrToken: signOrganizationQrToken('OTHER', qrTokenSecret)
  }));

  assert.equal(replay.status, 409);
  assert.equal(database.responsesByToken.size, 1);
});
