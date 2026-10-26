import { answersQuestions, questionnaire } from './questionnaire.js';

export function validateSubmission(body) {
  const errors = [];
  const addError = (field, message) => errors.push({ field, message });

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: '请求数据格式不正确' }];
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submitToken ?? '')) {
    addError('submitToken', '提交标识无效');
  }
  if (typeof body.qrToken !== 'string' || body.qrToken.length > 2048) {
    addError('qrToken', '机构二维码无效');
  }
  if (body.questionnaireVersion !== questionnaire.version) addError('questionnaireVersion', '问卷版本已更新');
  if (body.privacyVersion !== questionnaire.privacy.version) addError('privacyVersion', '隐私告知版本已更新');
  if (body.consent !== true) addError('consent', '请先阅读并同意隐私告知');
  if (![1, 2].includes(body.fillerType)) addError('fillerType', '请选择填写人类型');
  if (body.fillerType === 2 && !questionnaire.fillerRelations.some((item) => item.value === body.fillerRelation)) {
    addError('fillerRelation', '请选择与患者的关系');
  }
  if (body.fontLevel != null && !['STD', 'LARGE', 'XL'].includes(body.fontLevel)) {
    addError('fontLevel', '字号设置无效');
  }
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    addError('answers', '请完整填写问卷');
    return errors;
  }

  for (const question of answersQuestions) {
    const value = body.answers[question.field];
    const validation = question.validation ?? {};
    if (value === undefined || value === null || value === '') {
      if (question.required) addError(question.field, `请填写${question.label}`);
      continue;
    }
    if (question.type === 'text') {
      if (typeof value !== 'string') {
        addError(question.field, `${question.label}格式不正确`);
      } else if (value.trim().length < validation.minLength || value.trim().length > validation.maxLength) {
        addError(question.field, `${question.label}请填写${validation.minLength}到${validation.maxLength}个字`);
      }
    } else if (question.type === 'tel') {
      if (typeof value !== 'string' || !new RegExp(validation.pattern).test(value)) {
        addError(question.field, '请输入正确的11位手机号');
      }
    } else if (question.type === 'number') {
      const number = typeof value === 'number' ? value : Number(value);
      const decimals = String(value).includes('.') ? String(value).split('.')[1].length : 0;
      if (!Number.isFinite(number) || number < validation.min || number > validation.max ||
          decimals > validation.decimals || (validation.decimals === 0 && !Number.isInteger(number))) {
        addError(question.field, `${question.label}请填写${validation.min}到${validation.max}之间的有效数值`);
      }
    } else if (question.type === 'single' && !question.options.some((option) => option.value === value)) {
      addError(question.field, `请选择有效的${question.label}`);
    }
  }
  return errors;
}

export function normalizeAnswers(answers) {
  return Object.fromEntries(answersQuestions.map(({ field }) => [field, answers[field]]));
}
