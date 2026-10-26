import jwt from 'jsonwebtoken';
import { questionnaire } from './questionnaire.js';

const issuer = 'fivemanager';
const audience = 'patient-questionnaire';
const purpose = 'organization-questionnaire';

export function requireQrTokenSecret(secret = process.env.QR_TOKEN_SECRET) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('QR_TOKEN_SECRET must contain at least 32 characters');
  }
  return secret;
}

export function signOrganizationQrToken(orgCode, secret = process.env.QR_TOKEN_SECRET) {
  if (typeof orgCode !== 'string' || !/^[A-Za-z0-9_]{2,32}$/.test(orgCode)) {
    throw new Error('Organization code is invalid');
  }

  return jwt.sign({
    purpose,
    orgCode,
    questionnaireVersion: questionnaire.version
  }, requireQrTokenSecret(secret), {
    algorithm: 'HS256',
    issuer,
    audience,
    noTimestamp: true
  });
}

export function verifyOrganizationQrToken(token, secret = process.env.QR_TOKEN_SECRET) {
  const key = requireQrTokenSecret(secret);
  if (typeof token !== 'string' || token.length > 2048) return null;

  try {
    const claims = jwt.verify(token, key, {
      algorithms: ['HS256'],
      issuer,
      audience
    });
    if (claims.purpose !== purpose ||
        typeof claims.orgCode !== 'string' ||
        !/^[A-Za-z0-9_]{2,32}$/.test(claims.orgCode) ||
        typeof claims.questionnaireVersion !== 'string') {
      return null;
    }
    return {
      orgCode: claims.orgCode,
      questionnaireVersion: claims.questionnaireVersion
    };
  } catch {
    return null;
  }
}
