<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AdminPanel from './components/AdminPanel.vue';
import PatientHome from './components/PatientHome.vue';
import { request } from './api.js';

const isAdmin = window.location.pathname.startsWith('/admin');
const isHome = window.location.pathname === '/';
const fontLevels = ['std', 'large', 'xl'];
const fontLabels = { std: '标准', large: '大', xl: '特大' };
const fontLevel = ref('large');
const phase = ref('loading');
const config = ref(null);
const org = ref(null);
const organizations = ref([]);
const routeParams = new URLSearchParams(window.location.search);
const qrToken = ref(routeParams.get('qr') ?? '');
const legacyOrgCode = routeParams.get('org') ?? '';
const orgCode = ref('');
const consent = ref(false);
const fillerType = ref(1);
const fillerRelation = ref('');
const fillerName = ref('');
const answers = reactive({});
const pageIndex = ref(0);
const editingFromReview = ref(false);
const errors = reactive({});
const submitError = ref('');
const submitting = ref(false);
const startedAt = ref(null);
const submitToken = ref('');
const success = ref(null);
const restoredDraft = ref(null);
const healthQuestions = computed(() => (config.value?.questions ?? []).filter((question) => question.group !== 'basic' && question.group !== 'body' && question.type !== 'org'));
const pages = computed(() => {
  if (!config.value) return [];
  const basic = config.value.questions.filter((question) => question.group === 'basic' && question.type !== 'org');
  const body = config.value.questions.filter((question) => question.group === 'body');
  return [basic, body, ...healthQuestions.value.map((question) => [question])];
});
const currentQuestions = computed(() => pages.value[pageIndex.value] ?? []);
const progressQuestion = computed(() => pageIndex.value === 0 ? 4 : pageIndex.value === 1 ? 6 : 7 + pageIndex.value - 2);
const progressPercent = computed(() => Math.min(100, Math.round(progressQuestion.value / 16 * 100)));
const draftKey = computed(() => `survey_draft_${orgCode.value}_${config.value?.version ?? 'v1'}`);

function setFont(level) {
  fontLevel.value = level;
  document.documentElement.dataset.font = level;
  try {
    localStorage.setItem('survey_font_level', level);
  } catch {
    // Keep the selected font for this page session.
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === 'x' ? value : (value & 3 | 8)).toString(16);
  });
}

function readDraft() {
  try {
    const previousDraftKey = `survey_draft_${orgCode.value}_v1`;
    const currentDraft = localStorage.getItem(draftKey.value);
    const previousDraft = config.value?.version === 'v2'
      ? localStorage.getItem(previousDraftKey)
      : null;
    const draft = JSON.parse(currentDraft ?? previousDraft ?? 'null');
    if (draft && Date.now() - draft.savedAt < 86_400_000) restoredDraft.value = draft;
    else {
      localStorage.removeItem(draftKey.value);
      if (previousDraft) localStorage.removeItem(previousDraftKey);
    }
    if (!currentDraft && previousDraft && restoredDraft.value) {
      localStorage.setItem(draftKey.value, previousDraft);
      localStorage.removeItem(previousDraftKey);
    }
  } catch {
    restoredDraft.value = null;
  }
}

function saveDraft() {
  if (!['filler', 'survey', 'review'].includes(phase.value)) return;
  try {
    localStorage.setItem(draftKey.value, JSON.stringify({
      savedAt: Date.now(),
      phase: phase.value,
      answers: { ...answers },
      fillerType: fillerType.value,
      fillerRelation: fillerRelation.value,
      fillerName: fillerName.value,
      pageIndex: pageIndex.value,
      startedAt: startedAt.value
    }));
  } catch {
    // The survey can continue; draft recovery is best-effort when storage is unavailable.
  }
}

watch([answers, fillerType, fillerRelation, fillerName, pageIndex, phase], saveDraft, { deep: true });

function applyDraft(draft) {
  Object.assign(answers, draft.answers ?? {});
  fillerType.value = draft.fillerType ?? 1;
  fillerRelation.value = draft.fillerRelation ?? '';
  fillerName.value = draft.fillerName ?? '';
  pageIndex.value = Math.min(draft.pageIndex ?? 0, pages.value.length - 1);
  startedAt.value = draft.startedAt ?? Date.now();
  consent.value = true;
  submitToken.value = uuid();
  phase.value = draft.phase === 'review' ? 'review' : 'survey';
  restoredDraft.value = null;
}

function startFresh() {
  if (!consent.value) return;
  restoredDraft.value = null;
  phase.value = 'filler';
}

function beginSurvey() {
  if (fillerType.value === 2 && !fillerRelation.value) {
    errors.fillerRelation = '请选择与患者的关系';
    return;
  }
  errors.fillerRelation = '';
  startedAt.value = Date.now();
  submitToken.value = uuid();
  pageIndex.value = 0;
  phase.value = 'survey';
}

function validateQuestion(question) {
  const value = answers[question.field];
  if (value === undefined || value === null || value === '') return `请填写${question.label}`;
  const rule = question.validation ?? {};
  if (question.type === 'text') {
    if (String(value).trim().length < rule.minLength || String(value).trim().length > rule.maxLength) {
      return `${question.label}请填写${rule.minLength}到${rule.maxLength}个字`;
    }
  } else if (question.type === 'tel' && !new RegExp(rule.pattern).test(String(value))) {
    return '请输入正确的11位手机号';
  } else if (question.type === 'number') {
    const number = Number(value);
    const decimals = String(value).includes('.') ? String(value).split('.')[1].length : 0;
    if (!Number.isFinite(number) || number < rule.min || number > rule.max || decimals > rule.decimals ||
        (rule.decimals === 0 && !Number.isInteger(number))) {
      return `${question.label}请填写${rule.min}到${rule.max}之间的有效数值`;
    }
  } else if (question.type === 'single' && !question.options.some((option) => option.value === value)) {
    return `请选择${question.label}`;
  }
  return '';
}

function nextPage() {
  for (const question of currentQuestions.value) {
    const message = validateQuestion(question);
    errors[question.field] = message;
  }
  if (Object.values(errors).some(Boolean)) return;
  submitError.value = '';
  if (editingFromReview.value) {
    editingFromReview.value = false;
    phase.value = 'review';
  } else if (pageIndex.value < pages.value.length - 1) {
    pageIndex.value += 1;
  } else {
    phase.value = 'review';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function previousPage() {
  if (editingFromReview.value) {
    editingFromReview.value = false;
    phase.value = 'review';
  } else if (pageIndex.value > 0) pageIndex.value -= 1;
  else phase.value = 'filler';
}

function editQuestion(question) {
  const group = question.group;
  if (group === 'basic') pageIndex.value = 0;
  else if (group === 'body') pageIndex.value = 1;
  else pageIndex.value = 2 + healthQuestions.value.findIndex((item) => item.field === question.field);
  editingFromReview.value = true;
  phase.value = 'survey';
}

function answerLabel(question) {
  const value = answers[question.field];
  return question.options?.find((option) => option.value === value)?.label ?? value ?? '';
}

async function submit() {
  submitting.value = true;
  submitError.value = '';
  try {
    success.value = await request('/v1/responses', {
      method: 'POST',
      body: JSON.stringify({
        submitToken: submitToken.value,
        qrToken: qrToken.value,
        questionnaireVersion: config.value.version,
        privacyVersion: config.value.privacy.version,
        consent: true,
        fillerType: fillerType.value,
        fillerRelation: fillerType.value === 2 ? fillerRelation.value : null,
        fillerName: fillerType.value === 2 ? fillerName.value : null,
        startedAt: startedAt.value,
        fontLevel: fontLevel.value.toUpperCase() === 'STD' ? 'STD' : fontLevel.value.toUpperCase(),
        answers: { ...answers },
        website: ''
      })
    });
    try {
      localStorage.removeItem(draftKey.value);
    } catch {
      // The submitted response is already saved on the server.
    }
    phase.value = 'success';
  } catch (error) {
    submitError.value = error.message || '提交失败，请再点一次';
  } finally {
    submitting.value = false;
  }
}

function newPatient() {
  for (const field of Object.keys(answers)) delete answers[field];
  fillerType.value = 1;
  fillerRelation.value = '';
  fillerName.value = '';
  consent.value = true;
  startedAt.value = null;
  submitToken.value = uuid();
  pageIndex.value = 0;
  success.value = null;
  phase.value = 'filler';
}

async function loadQuestionnaire(token) {
  try {
    if (!token) {
      organizations.value = await request('/v1/orgs');
      if (!organizations.value.length) {
        phase.value = 'invalid';
        return;
      }
      phase.value = 'choose-org';
      return;
    }
    const result = await request(`/v1/questionnaire?qr=${encodeURIComponent(token)}`);
    org.value = result.org;
    orgCode.value = result.org.code;
    qrToken.value = result.qrToken;
    const url = new URL(window.location.href);
    url.searchParams.delete('org');
    url.searchParams.set('qr', qrToken.value);
    window.history.replaceState(null, '', url);
    config.value = result.questionnaire;
    readDraft();
    phase.value = 'welcome';
  } catch (error) {
    submitError.value = error.message;
    phase.value = 'invalid';
  }
}

onMounted(() => {
  if (isAdmin || isHome) return;
  if (legacyOrgCode && !qrToken.value) {
    submitError.value = '这是旧版机构二维码，无法验证机构信息。请联系工作人员重新生成并张贴二维码。';
    phase.value = 'invalid';
    return;
  }
  try {
    const savedFont = localStorage.getItem('survey_font_level');
    if (fontLevels.includes(savedFont)) fontLevel.value = savedFont;
  } catch {
    fontLevel.value = 'large';
  }
  document.documentElement.dataset.font = fontLevel.value;
  loadQuestionnaire(qrToken.value);
});
</script>

<template>
  <AdminPanel v-if="isAdmin" />
  <PatientHome v-else-if="isHome" />
  <main v-else class="survey-shell">
    <header v-if="!['loading', 'invalid', 'success', 'choose-org'].includes(phase)" class="survey-header">
      <div class="font-switch" aria-label="字号切换">
        <span>字号：</span>
        <button v-for="level in fontLevels" :key="level" type="button" :aria-pressed="fontLevel === level" :class="{ active: fontLevel === level }" @click="setFont(level)">
          {{ fontLabels[level] }}
        </button>
      </div>
      <div v-if="phase === 'survey' || phase === 'review'" class="progress">
        <div class="progress-copy"><span>第 {{ progressQuestion }} 题 / 共 16 题</span><span>{{ org?.name }}</span></div>
        <div class="progress-track"><i :style="{ width: `${progressPercent}%` }"></i></div>
      </div>
      <div v-if="fillerType === 2 && (phase === 'survey' || phase === 'review')" class="filler-banner">您正在帮患者填写，请按患者实际情况回答</div>
    </header>

    <section v-if="phase === 'loading'" class="panel centered"><p>正在打开问卷…</p></section>

    <section v-else-if="phase === 'invalid'" class="panel centered invalid-panel">
      <div class="large-icon">!</div><h1>该二维码已失效</h1><p>{{ submitError || '请联系工作人员' }}</p>
    </section>

    <section v-else-if="phase === 'choose-org'" class="panel">
      <p class="eyebrow">欢迎填写</p><h1>请选择所在机构</h1>
      <a v-for="item in organizations" :key="item.code" class="choice-card org-choice" :href="item.questionnaireUrl">{{ item.name }}<span>›</span></a>
    </section>

    <section v-else-if="phase === 'welcome'" class="panel welcome-panel">
      <p class="eyebrow">{{ org?.name }}</p>
      <p v-if="org?.address" class="org-address">{{ org.address }}</p>
      <h1>{{ config.title }}</h1>
      <p class="intro">{{ config.intro }}</p>
      <div v-if="restoredDraft" class="restore-box">
        <strong>发现上次未完成的填写</strong>
        <p>已为您保留填写内容，可以接着填写。</p>
        <button class="button secondary" @click="applyDraft(restoredDraft)">继续填写</button>
        <button class="text-button" @click="restoredDraft = null; startFresh()">重新开始</button>
      </div>
      <template v-else>
        <div class="privacy-box"><strong>隐私知情同意</strong><p>{{ config.privacy.text }}</p></div>
        <label class="consent-line"><input v-model="consent" type="checkbox"><span>我已阅读并同意以上隐私告知</span></label>
        <button class="button primary full" :disabled="!consent" @click="startFresh">开始填写</button>
      </template>
      <p class="small-note">本问卷不提供健康评估结论。如有不适，请及时咨询医务人员。</p>
    </section>

    <section v-else-if="phase === 'filler'" class="panel">
      <p class="eyebrow">{{ org?.name }}</p><h1>谁在填写问卷？</h1>
      <div class="choice-grid">
        <button class="choice-card" :class="{ selected: fillerType === 1 }" @click="fillerType = 1; fillerRelation = ''">本人填写</button>
        <button class="choice-card" :class="{ selected: fillerType === 2 }" @click="fillerType = 2">家人或他人代填</button>
      </div>
      <template v-if="fillerType === 2">
        <h2 class="subheading">与患者的关系（必选）</h2>
        <p v-if="errors.fillerRelation" class="error-text">{{ errors.fillerRelation }}</p>
        <div class="choice-grid relation-grid">
          <button v-for="relation in config.fillerRelations" :key="relation.value" class="choice-card" :class="{ selected: fillerRelation === relation.value }" @click="fillerRelation = relation.value; errors.fillerRelation = ''">{{ relation.label }}</button>
        </div>
        <label class="field-label">代填人姓名（选填）<input v-model="fillerName" maxlength="50" autocomplete="off" placeholder="请输入姓名"></label>
      </template>
      <div class="actions"><button class="button secondary" @click="phase = 'welcome'">上一步</button><button class="button primary" @click="beginSurvey">下一步</button></div>
    </section>

    <section v-else-if="phase === 'survey'" class="panel">
      <p class="eyebrow">{{ pageIndex === 0 ? '基本信息' : pageIndex === 1 ? '基本信息' : '健康情况' }}</p>
      <div v-for="question in currentQuestions" :key="question.id" class="question-block">
        <h1>{{ question.label }}</h1>
        <p v-if="question.hint" class="hint">{{ question.hint }}</p>
        <div v-if="question.type === 'single'" class="options">
          <button v-for="option in question.options" :key="option.value" class="option-card" :class="{ selected: answers[question.field] === option.value }" @click="answers[question.field] = option.value; errors[question.field] = ''">
            <span class="radio-mark">{{ answers[question.field] === option.value ? '✓' : '' }}</span><span class="option-content"><strong>{{ option.label }}</strong><small v-if="option.desc">{{ option.desc }}</small></span>
          </button>
        </div>
        <label v-else class="input-wrap">
          <input v-model="answers[question.field]" :type="question.type === 'tel' ? 'tel' : question.type === 'number' ? 'number' : 'text'" :inputmode="question.type === 'number' ? (question.validation?.decimals ? 'decimal' : 'numeric') : question.type === 'tel' ? 'numeric' : 'text'" :maxlength="question.validation?.maxLength" :min="question.validation?.min" :max="question.validation?.max" :step="question.validation?.decimals ? '0.1' : '1'" :placeholder="`请输入${question.label}`" autocomplete="off" @input="errors[question.field] = ''">
          <span v-if="question.unit" class="unit">{{ question.unit }}</span>
        </label>
        <p v-if="errors[question.field]" class="error-text" role="alert">{{ errors[question.field] }}</p>
      </div>
      <div class="actions"><button class="button secondary" @click="previousPage">上一步</button><button class="button primary" @click="nextPage">{{ pageIndex === pages.length - 1 ? '核对答案' : '下一步' }}</button></div>
    </section>

    <section v-else-if="phase === 'review'" class="panel review-panel">
      <p class="eyebrow">最后一步</p><h1>请核对填写内容</h1>
      <div v-for="question in config.questions.filter((item) => item.type !== 'org')" :key="question.id" class="review-row">
        <div><span>{{ question.label }}</span><strong>{{ answerLabel(question) }}</strong></div>
        <button class="text-button" @click="editQuestion(question)">修改</button>
      </div>
      <p v-if="submitError" class="error-text submit-error">{{ submitError }}</p>
      <div class="actions"><button class="button secondary" @click="previousPage">上一步</button><button class="button primary" :disabled="submitting" @click="submit">{{ submitting ? '正在提交…' : '确认并提交' }}</button></div>
    </section>

    <section v-else-if="phase === 'success'" class="panel centered success-panel">
      <div class="success-icon">✓</div><h1>提交成功，谢谢您！</h1>
      <p>填写时间：{{ success.submittedAt }}</p><p>提交编号：{{ success.responseNo }}</p>
      <button class="button primary full" @click="newPatient">再帮另一位填写</button>
    </section>
    <footer class="site-footer">四高慢病健康管理系统</footer>
  </main>
</template>
