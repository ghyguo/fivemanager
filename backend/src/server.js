import express from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { pool } from './db.js';
import { answersQuestions, optionLabel, questionnaire } from './questionnaire.js';
import { organizationQuestionnaireUrl, qrPng } from './qrcode.js';
import { parseResponseRateLimit, createIpRateLimiter } from './rate-limit.js';
import { requireQrTokenSecret, verifyOrganizationQrToken } from './qr-token.js';
import { submitSurveyResponse } from './response-submission.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);
const jwtSecret = process.env.JWT_SECRET ?? '';
const qrTokenSecret = requireQrTokenSecret();
const rateLimit = parseResponseRateLimit(process.env.RATE_LIMIT_PER_MINUTE_PER_IP);
const failures = new Map();
const adminPrefix = '/api/admin/v1';
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
if (!process.env.ADMIN_INIT_PASSWORD || process.env.ADMIN_INIT_PASSWORD.length < 8) {
  throw new Error('ADMIN_INIT_PASSWORD must contain at least 8 characters');
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(express.json({ limit: '20kb', strict: true }));

function ok(res, data, message = 'ok') {
  return res.json({ code: 0, message, data });
}

function fail(res, status, code, message, data) {
  return res.status(status).json({ code, message, ...(data === undefined ? {} : { data }) });
}

function timestamp(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function getClientIp(req) {
  const forwarded = req.get('x-real-ip');
  return (forwarded || req.ip || req.socket.remoteAddress || '').slice(0, 45);
}

function audit(event, details = {}) {
  console.info(JSON.stringify({ time: timestamp(), event, ...details }));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAdmin(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 40101, '未登录或登录已过期');
  try {
    req.admin = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return fail(res, 401, 40101, '未登录或登录已过期');
  }
}

app.post('/api/v1/responses', createIpRateLimiter({ limit: rateLimit, getIp: getClientIp }));

app.get('/api/v1/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  return ok(res, 'UP');
}));

app.get('/api/v1/config', (_req, res) => ok(res, {
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost'
}));

app.get('/api/v1/orgs', asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute(
    'SELECT org_code AS code, org_name AS name, org_address AS address FROM survey_org WHERE status = 1 ORDER BY sort_no, id'
  );
  return ok(res, rows.map((org) => ({
    ...org,
    questionnaireUrl: organizationQuestionnaireUrl(org.code)
  })));
}));

app.get('/api/v1/questionnaire', asyncRoute(async (req, res) => {
  const token = typeof req.query.qr === 'string' ? req.query.qr : '';
  const claims = verifyOrganizationQrToken(token, qrTokenSecret);
  if (!claims || claims.questionnaireVersion !== questionnaire.version) {
    return fail(res, 400, 40001, '二维码无效或问卷版本已更新，请扫描机构最新二维码');
  }
  const [orgs] = await pool.execute(
    'SELECT org_code, org_name, org_address FROM survey_org WHERE org_code = ? AND status = 1 LIMIT 1',
    [claims.orgCode]
  );
  if (!orgs.length) return fail(res, 404, 40401, '该二维码已失效，请联系工作人员');
  return ok(res, {
    org: { code: orgs[0].org_code, name: orgs[0].org_name, address: orgs[0].org_address },
    questionnaire,
    qrToken: token
  });
}));

app.post('/api/v1/responses', asyncRoute(async (req, res) => {
  const result = await submitSurveyResponse({
    pool,
    body: req.body,
    qrTokenSecret,
    clientIp: getClientIp(req),
    userAgent: req.get('user-agent') ?? ''
  });
  return res.status(result.status).json(result.payload);
}));

app.post(`${adminPrefix}/login`, asyncRoute(async (req, res) => {
  const username = String(req.body?.username ?? '').slice(0, 50);
  const ip = getClientIp(req);
  const key = `${ip}:${username}`;
  const now = Date.now();
  const record = failures.get(key);
  if (record?.lockedUntil > now) return fail(res, 429, 42901, '登录失败次数过多，请10分钟后再试');

  const [admins] = await pool.execute(
    'SELECT id, username, password_hash, enabled FROM sys_admin WHERE username = ? LIMIT 1',
    [username]
  );
  const admin = admins[0];
  const matched = admin && admin.enabled === 1
    ? await bcrypt.compare(String(req.body?.password ?? ''), admin.password_hash)
    : false;
  if (!matched) {
    const attempts = (record?.attempts ?? 0) + 1;
    failures.set(key, { attempts, lockedUntil: attempts >= 5 ? now + 600_000 : 0 });
    audit('admin.login.failed', { username, ip });
    return fail(res, 401, 40101, '账号或密码错误');
  }

  failures.delete(key);
  await pool.execute('UPDATE sys_admin SET last_login_at = ? WHERE id = ?', [timestamp(), admin.id]);
  const token = jwt.sign({ id: admin.id, username: admin.username }, jwtSecret, { expiresIn: '8h' });
  audit('admin.login.success', { username, ip });
  return ok(res, { token, expiresIn: 28_800 });
}));

app.use(adminPrefix, requireAdmin);

app.get(`${adminPrefix}/config`, (_req, res) => ok(res, {
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost'
}));

app.get(`${adminPrefix}/orgs`, asyncRoute(async (req, res) => {
  const keyword = `%${String(req.query.keyword ?? '').slice(0, 100)}%`;
  const [rows] = await pool.execute(
    `SELECT o.id, o.org_code, o.org_name, o.org_address, o.status, o.created_at,
      COUNT(r.id) AS response_count
     FROM survey_org o
     LEFT JOIN survey_response r ON r.org_code = o.org_code AND r.is_deleted = 0
     WHERE o.org_name LIKE ?
     GROUP BY o.id
     ORDER BY o.sort_no, o.id`,
    [keyword]
  );
  return ok(res, rows.map((row) => ({
    id: row.id,
    code: row.org_code,
    name: row.org_name,
    address: row.org_address,
    questionnaireUrl: organizationQuestionnaireUrl(row.org_code),
    status: row.status,
    responseCount: Number(row.response_count),
    createdAt: row.created_at
  })));
}));

app.post(`${adminPrefix}/orgs`, asyncRoute(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  let code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!name || name.length > 100) return fail(res, 400, 40001, '机构名称必填且不能超过100个字');
  if (!address || address.length > 255) return fail(res, 400, 40001, '机构地址必填且不能超过255个字');
  if (code && !/^[A-Za-z0-9_]{2,32}$/.test(code)) return fail(res, 400, 40001, '机构编码须为2到32位字母、数字或下划线');
  if (!code) {
    const [[row]] = await pool.execute('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM survey_org');
    code = `ORG${String(row.next_id).padStart(4, '0')}`;
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO survey_org (org_code, org_name, org_address, status, sort_no) VALUES (?, ?, ?, 1, 0)',
      [code, name, address]
    );
    return ok(res, { id: result.insertId, code, name, address, status: 1 }, 'created');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 40901, '该编码已存在');
    throw error;
  }
}));

app.put(`${adminPrefix}/orgs/:id`, asyncRoute(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  if (!name || name.length > 100) return fail(res, 400, 40001, '机构名称必填且不能超过100个字');
  if (!address || address.length > 255) return fail(res, 400, 40001, '机构地址必填且不能超过255个字');
  const [result] = await pool.execute(
    'UPDATE survey_org SET org_name = ?, org_address = ? WHERE id = ?',
    [name, address, req.params.id]
  );
  if (!result.affectedRows) return fail(res, 404, 40401, '机构不存在');
  return ok(res, { id: Number(req.params.id), name, address });
}));

app.put(`${adminPrefix}/orgs/:id/status`, asyncRoute(async (req, res) => {
  if (![0, 1].includes(req.body?.status)) return fail(res, 400, 40001, '机构状态无效');
  const [result] = await pool.execute('UPDATE survey_org SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  if (!result.affectedRows) return fail(res, 404, 40401, '机构不存在');
  return ok(res, { id: Number(req.params.id), status: req.body.status });
}));

app.get('/api/v1/orgs/:code/qrcode', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT org_name FROM survey_org WHERE org_code = ? AND status = 1 LIMIT 1',
    [req.params.code]
  );
  if (!rows.length) return fail(res, 404, 40401, '该二维码已失效，请联系工作人员');
  const png = await qrPng(req.params.code, rows[0].org_name, 300);
  return res.type('png').send(png);
}));

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '机构';
}

app.get(`${adminPrefix}/orgs/:code/qrcode`, asyncRoute(async (req, res) => {
  const size = Number(req.query.size ?? 600);
  if (![300, 600, 1200].includes(size)) return fail(res, 400, 40001, '二维码尺寸无效');
  const [rows] = await pool.execute('SELECT org_name FROM survey_org WHERE org_code = ? LIMIT 1', [req.params.code]);
  if (!rows.length) return fail(res, 404, 40401, '机构不存在');
  const png = await qrPng(req.params.code, rows[0].org_name, size);
  if (req.query.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFilename(rows[0].org_name)}_二维码.png`)}`);
  }
  res.type('png').send(png);
}));

app.post(`${adminPrefix}/orgs/qrcode-zip`, asyncRoute(async (req, res, next) => {
  const codes = Array.isArray(req.body?.codes) ? [...new Set(req.body.codes)].slice(0, 100) : [];
  const size = Number(req.body?.size ?? 600);
  if (!codes.length || !codes.every((code) => typeof code === 'string') || ![300, 600, 1200].includes(size)) {
    return fail(res, 400, 40001, '请选择有效机构和二维码尺寸');
  }
  const placeholders = codes.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT org_code, org_name FROM survey_org WHERE org_code IN (${placeholders})`,
    codes
  );
  if (rows.length !== codes.length) return fail(res, 404, 40401, '部分机构不存在');
  res.attachment('机构二维码.zip');
  res.type('application/zip');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', next);
  archive.pipe(res);
  for (const org of rows) {
    archive.append(await qrPng(org.org_code, org.org_name, size), {
      name: `${safeFilename(org.org_name)}_${org.org_code}.png`
    });
  }
  await archive.finalize();
}));

function responseWhere(query) {
  const conditions = ['r.is_deleted = 0'];
  const values = [];
  if (query.startTime) { conditions.push('r.submitted_at >= ?'); values.push(String(query.startTime).replace('T', ' ')); }
  if (query.endTime) { conditions.push('r.submitted_at <= ?'); values.push(String(query.endTime).replace('T', ' ')); }
  if (query.orgCode) { conditions.push('r.org_code = ?'); values.push(String(query.orgCode).slice(0, 32)); }
  if (query.name) { conditions.push('r.patient_name LIKE ?'); values.push(`%${String(query.name).slice(0, 50)}%`); }
  if (query.phone) { conditions.push('r.phone LIKE ?'); values.push(`%${String(query.phone).replace(/\D/g, '').slice(0, 11)}%`); }
  if (query.fillerType === '1' || query.fillerType === '2') {
    conditions.push('r.filler_type = ?');
    values.push(Number(query.fillerType));
  }
  return { clause: conditions.join(' AND '), values };
}

function maskPhone(phone) {
  return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function responseSummary(row, reveal = false) {
  return {
    id: row.id,
    responseNo: row.response_no,
    patientName: row.patient_name,
    gender: row.gender,
    age: row.age,
    phone: reveal ? row.phone : maskPhone(row.phone),
    orgCode: row.org_code,
    orgName: row.org_name,
    fillerType: row.filler_type,
    submittedAt: row.submitted_at,
    bmi: row.bmi
  };
}

app.get(`${adminPrefix}/responses`, asyncRoute(async (req, res) => {
  const { clause, values } = responseWhere(req.query);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(req.query.size, 10) || 20));
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM survey_response r WHERE ${clause}`, values);
  const [rows] = await pool.execute(
    `SELECT r.id, r.response_no, r.patient_name, r.gender, r.age, r.phone, r.org_code, r.org_name,
      r.filler_type, r.submitted_at, r.bmi
     FROM survey_response r WHERE ${clause}
     ORDER BY r.submitted_at DESC LIMIT ? OFFSET ?`,
    [...values, size, (page - 1) * size]
  );
  return ok(res, { items: rows.map((row) => responseSummary(row)), page, size, total: Number(count.total) });
}));

app.get(`${adminPrefix}/responses/export`, asyncRoute(async (req, res) => {
  const { clause, values } = responseWhere(req.query);
  const [rows] = await pool.execute(
    `SELECT r.* FROM survey_response r WHERE ${clause} ORDER BY r.submitted_at DESC LIMIT 50000`,
    values
  );
  audit('admin.responses.exported', { admin: req.admin.username, count: rows.length });
  const headings = [
    ['id', '记录ID'], ['response_no', '提交编号'], ['submit_token', '提交幂等标识'],
    ['questionnaire_version', '问卷版本'], ['privacy_version', '隐私告知版本'],
    ['org_code', '机构编码'], ['org_name', '机构名称'], ['filler_type', '填写人类型'],
    ['filler_relation', '与患者关系'], ['filler_name', '代填人姓名'], ['patient_name', '姓名'],
    ['gender', '性别'], ['age', '年龄'], ['phone', '手机号'], ['height_cm', '身高（厘米）'],
    ['weight_kg', '体重（千克）'], ['bmi', 'BMI'], ['bp_status', '血压情况'],
    ['glucose_status', '血糖情况'], ['lipid_status', '血脂情况'], ['salt_status', '控盐情况'],
    ['smoking_status', '吸烟情况'], ['exercise_status', '运动情况'], ['family_cvd', '心脑血管病家族史'],
    ['has_cvd', '是否有心脑血管病'], ['has_cerebro', '是否有脑血管病'], ['has_chronic', '是否有慢性病'],
    ['answers_json', '问卷答案快照'], ['started_at', '开始填写时间'], ['submitted_at', '提交时间'],
    ['duration_seconds', '填写耗时（秒）'], ['consent_at', '同意时间'], ['font_level', '字号档位'],
    ['client_ip', '客户端IP'], ['user_agent', '客户端信息'], ['is_deleted', '软删除标记'],
    ['created_at', '创建时间'], ['updated_at', '更新时间']
  ];
  const enumFields = new Set(answersQuestions.filter((question) => question.options).map((question) => question.field));
  const exportRows = rows.map((row) => Object.fromEntries(headings.map(([key, label]) => {
    let value = row[key];
    if (key === 'gender') value = value === 'M' ? '男' : '女';
    else if (key === 'filler_type') value = value === 1 ? '本人填写' : '他人代填';
    else if (key === 'filler_relation') value = questionnaire.fillerRelations.find((item) => item.value === value)?.label ?? value;
    else if (key === 'font_level') value = ({ STD: '标准', LARGE: '大', XL: '特大' })[value] ?? value;
    else if (key === 'is_deleted') value = value === 1 ? '已删除' : '未删除';
    else if (key === 'answers_json' && typeof value !== 'string') value = JSON.stringify(value);
    else if (enumFields.has(key)) value = optionLabel(key, value);
    return [label, value ?? ''];
  })));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('四高问卷填写记录.xlsx')}`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: false,
    useSharedStrings: false
  });
  const sheet = workbook.addWorksheet('填写记录');
  sheet.addRow(headings.map(([, label]) => label)).commit();
  for (const row of exportRows) sheet.addRow(headings.map(([, label]) => row[label])).commit();
  sheet.commit();
  await workbook.commit();
}));

app.get(`${adminPrefix}/responses/:id`, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM survey_response WHERE id = ? AND is_deleted = 0 LIMIT 1', [req.params.id]);
  const row = rows[0];
  if (!row) return fail(res, 404, 40401, '记录不存在');
  const reveal = req.query.revealPhone === 'true';
  if (reveal) audit('admin.response.phone.revealed', { admin: req.admin.username, responseId: row.id });
  let snapshot = row.answers_json;
  if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot);
  const answers = snapshot.answers ?? {};
  return ok(res, {
    ...responseSummary(row, reveal),
    privacyVersion: row.privacy_version,
    questionnaireVersion: row.questionnaire_version,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds,
    fontLevel: row.font_level,
    answers: snapshot.questions.filter((question) => question.type !== 'org').map((question) => ({
      field: question.field,
      label: question.label,
      value: question.options
        ? question.options.find((option) => option.value === answers[question.field])?.label ?? answers[question.field]
        : answers[question.field]
    }))
  });
}));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error.type === 'entity.too.large') return fail(res, 413, 40001, '请求内容不能超过20KB');
  if (error instanceof SyntaxError && error.status === 400) return fail(res, 400, 40001, '请求数据格式不正确');
  if (['POOL_ENQUEUELIMIT', 'ETIMEDOUT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return fail(res, 503, 50301, '服务暂时繁忙，请稍后重试');
  }
  console.error(JSON.stringify({
    time: timestamp(),
    event: 'request.error',
    errorCode: typeof error.code === 'string' ? error.code : 'INTERNAL'
  }));
  return fail(res, 500, 50000, '服务器暂时无法处理请求');
});

async function initialize() {
  await pool.query('SELECT 1');
  const username = process.env.ADMIN_INIT_USERNAME ?? 'admin';
  const passwordHash = await bcrypt.hash(process.env.ADMIN_INIT_PASSWORD, 12);
  await pool.execute(
    'INSERT INTO sys_admin (username, password_hash, enabled) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE username = username',
    [username, passwordHash]
  );
  app.listen(port, '0.0.0.0', () => console.info(`Four-high survey API listening on ${port}`));
}

initialize().catch((error) => {
  console.error(JSON.stringify({
    event: 'startup.failed',
    errorCode: typeof error.code === 'string' ? error.code : 'INTERNAL'
  }));
  return pool.end().then(() => {
    process.exitCode = 1;
  });
});
