import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const filename = fileURLToPath(import.meta.url);
const questionnairePath = path.resolve(path.dirname(filename), '../questionnaire/questionnaire-v1.json');

export const questionnaire = JSON.parse(await readFile(questionnairePath, 'utf8'));
export const answersQuestions = questionnaire.questions.filter((question) => question.type !== 'org');

export function optionLabel(field, value) {
  const question = answersQuestions.find((item) => item.field === field);
  return question?.options?.find((option) => option.value === value)?.label ?? String(value ?? '');
}
