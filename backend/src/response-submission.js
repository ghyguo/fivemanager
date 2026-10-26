import { questionnaire } from './questionnaire.js';
import { verifyOrganizationQrToken } from './qr-token.js';
import { normalizeAnswers, validateSubmission } from './validation.js';

function timestamp(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function dateFromDatabase(value) {
  if (value instanceof Date) return value;
  return new Date(`${String(value).replace(' ', 'T')}+08:00`);
}

function formatResponseNo(date = new Date()) {
  const compact = timestamp(date).replace(/[-: ]/g, '');
  return `${compact}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
}

function success(data) {
  return { status: 200, payload: { code: 0, message: 'ok', data } };
}

function failure(status, code, message, data) {
  return {
    status,
    payload: { code, message, ...(data === undefined ? {} : { data }) }
  };
}

function existingSubmission(row, claims) {
  if (row.org_code !== claims.orgCode ||
      row.questionnaire_version !== claims.questionnaireVersion) {
    return failure(409, 40902, '该提交标识已用于其他机构或问卷');
  }
  return success({
    responseNo: row.response_no,
    submittedAt: timestamp(dateFromDatabase(row.submitted_at))
  });
}

export async function submitSurveyResponse({
  pool,
  body,
  qrTokenSecret,
  clientIp = '',
  userAgent = '',
  now = new Date()
}) {
  if (body?.website && String(body.website).trim()) {
    return success({ responseNo: formatResponseNo(now), submittedAt: timestamp(now) });
  }

  const claims = verifyOrganizationQrToken(body?.qrToken, qrTokenSecret);
  if (!claims || claims.questionnaireVersion !== questionnaire.version) {
    return failure(400, 40001, '二维码无效或问卷版本已更新，请扫描机构最新二维码');
  }
  if (body.org !== undefined && body.org !== claims.orgCode) {
    return failure(400, 40001, '提交机构与二维码不匹配');
  }

  const errors = validateSubmission(body);
  if (errors.length) return failure(400, 40001, '参数校验失败', { errors });

  const answers = normalizeAnswers(body.answers);
  const [existing] = await pool.execute(
    `SELECT response_no, submitted_at, org_code, questionnaire_version
     FROM survey_response WHERE submit_token = ? LIMIT 1`,
    [body.submitToken]
  );
  if (existing.length) return existingSubmission(existing[0], claims);

  const [orgRows] = await pool.execute(
    'SELECT org_code, org_name FROM survey_org WHERE org_code = ? AND status = 1 LIMIT 1',
    [claims.orgCode]
  );
  if (!orgRows.length) return failure(404, 40401, '该二维码已失效，请联系工作人员');

  const submittedAt = timestamp(now);
  const started = Number(body.startedAt);
  const startedDate = Number.isFinite(started) ? new Date(started) : null;
  const elapsed = startedDate ? Math.floor((now.getTime() - startedDate.getTime()) / 1000) : null;
  const duration = elapsed !== null && elapsed >= 0 && elapsed <= 86_400 ? elapsed : null;
  const startedAt = startedDate && Number.isFinite(startedDate.getTime()) && duration !== null
    ? timestamp(startedDate)
    : null;
  const heightMeters = Number(answers.height_cm) / 100;
  const bmi = Math.round((Number(answers.weight_kg) / (heightMeters * heightMeters)) * 10) / 10;
  let responseNo = formatResponseNo(now);
  const fillerType = body.fillerType;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await pool.execute(
        `INSERT INTO survey_response (
          response_no, submit_token, questionnaire_version, privacy_version, org_code, org_name,
          filler_type, filler_relation, filler_name, patient_name, gender, age, phone, height_cm,
          weight_kg, bmi, bp_status, glucose_status, lipid_status, salt_status, smoking_status,
          exercise_status, family_cvd, has_cvd, has_cerebro, has_chronic, answers_json,
          started_at, submitted_at, duration_seconds, consent_at, font_level, client_ip, user_agent
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )`,
        [
          responseNo, body.submitToken, claims.questionnaireVersion, questionnaire.privacy.version,
          orgRows[0].org_code, orgRows[0].org_name, fillerType,
          fillerType === 2 ? body.fillerRelation : null,
          fillerType === 2 ? String(body.fillerName ?? '').slice(0, 50) || null : null,
          answers.patient_name.trim(), answers.gender, answers.age, answers.phone,
          answers.height_cm, answers.weight_kg, bmi, answers.bp_status, answers.glucose_status,
          answers.lipid_status, answers.salt_status, answers.smoking_status, answers.exercise_status,
          answers.family_cvd, answers.has_cvd, answers.has_cerebro, answers.has_chronic,
          JSON.stringify({ questions: questionnaire.questions, answers }),
          startedAt, submittedAt, duration, submittedAt, body.fontLevel ?? 'LARGE',
          clientIp, userAgent.slice(0, 255)
        ]
      );
      return success({ responseNo, submittedAt });
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;

      const [duplicate] = await pool.execute(
        `SELECT response_no, submitted_at, org_code, questionnaire_version
         FROM survey_response WHERE submit_token = ? LIMIT 1`,
        [body.submitToken]
      );
      if (duplicate.length) return existingSubmission(duplicate[0], claims);
      if (attempt === 2) throw error;
      responseNo = formatResponseNo(new Date(now.getTime() + attempt + 1));
    }
  }

  throw new Error('Unable to persist survey response after retrying unique-key conflicts');
}
