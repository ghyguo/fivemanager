import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnaire } from '../src/questionnaire.js';
import { validateSubmission } from '../src/validation.js';

function validSubmission(overrides = {}) {
  return {
    submitToken: 'b3d5c0de-8c1e-4f7a-9d2e-1f6a0c9e7a11',
    qrToken: 'signed-organization-questionnaire-token',
    questionnaireVersion: questionnaire.version,
    privacyVersion: questionnaire.privacy.version,
    consent: true,
    fillerType: 2,
    fillerRelation: 'CHILD',
    fontLevel: 'LARGE',
    answers: {
      patient_name: '王大爷', gender: 'M', age: 72, phone: '13800138000',
      height_cm: 168, weight_kg: 70.5, bp_status: 'HTN', glucose_status: 'UNKNOWN',
      lipid_status: 'NORMAL', salt_status: 'HIGH', smoking_status: 'SECONDHAND',
      exercise_status: 'LOW', family_cvd: 'Y', has_cvd: 'Y', has_cerebro: 'N', has_chronic: 'Y'
    },
    ...overrides
  };
}

test('accepts a complete submission whose values match the questionnaire', () => {
  assert.deepEqual(validateSubmission(validSubmission()), []);
});

test('rejects invalid values using configuration-based field validation', () => {
  const body = validSubmission({
    answers: { ...validSubmission().answers, phone: '12345', age: 150, bp_status: 'NOT_AN_OPTION' }
  });
  const fields = validateSubmission(body).map((error) => error.field);
  assert.ok(fields.includes('phone'));
  assert.ok(fields.includes('age'));
  assert.ok(fields.includes('bp_status'));
});

test('requires consent and a relationship for proxy submissions', () => {
  const errors = validateSubmission(validSubmission({ consent: false, fillerRelation: '' }));
  assert.ok(errors.some((error) => error.field === 'consent'));
  assert.ok(errors.some((error) => error.field === 'fillerRelation'));
});
