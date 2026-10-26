import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnaire } from '../src/questionnaire.js';

test('questionnaire wording follows the 2026 workbook', () => {
  assert.equal(questionnaire.version, 'v2');
  assert.deepEqual(
    questionnaire.questions.map((question) => question.label),
    [
      '筛选机构',
      '姓名',
      '性别',
      '年龄（岁）',
      '手机号',
      '身高（厘米）',
      '体重（千克）',
      '您的血压情况',
      '您的血糖情况',
      '您的血脂情况',
      '你的控盐情况',
      '您是否吸烟',
      '您的运动情况',
      '您是否有心脑血管病家族史',
      '您是否有心脑血管病（高血压、冠心病、房颤、心瓣膜病）',
      '您是否有脑血管病（头痛、眩晕、失眠、抑郁、焦虑、认知障碍、运动障碍等）',
      '您是否慢性病'
    ]
  );
});

test('health answer choices include the full workbook wording', () => {
  const questions = new Map(questionnaire.questions.map((question) => [question.field, question]));
  assert.deepEqual(
    questions.get('bp_status').options.map((option) => option.label),
    [
      '正常（高压90-120/低压60-80毫米汞柱）',
      '早期高血压（高压121-139/低压81-89毫米汞柱）',
      '高血压病（高压≧140或/低压≧90毫米汞柱）',
      '不晓得（未测量过或测量过但不知道高不高）'
    ]
  );
  assert.equal(
    questions.get('glucose_status').options[2].label,
    '糖尿病(空腹血糖≧7,餐后和随机血糖≧11.1mmol/L，糖化血红蛋白≧6.5%)'
  );
  assert.deepEqual(
    questions.get('has_chronic').options.map((option) => option.label),
    ['否', '是（高血压、糖尿病、冠心病、脑血管病等）']
  );
});
