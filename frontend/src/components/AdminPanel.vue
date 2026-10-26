<script setup>
import { computed, onMounted, ref } from 'vue';
import { clearToken, getToken, request, setToken } from '../api.js';

const token = ref(getToken());
const username = ref('');
const password = ref('');
const loginError = ref('');
const error = ref('');
const info = ref('');
const activeTab = ref('orgs');
const orgs = ref([]);
const keyword = ref('');
const selected = ref([]);
const orgForm = ref({ name: '', address: '', code: '' });
const orgFormOpen = ref(false);
const orgFormError = ref('');
const editingOrgId = ref(null);
const savingOrg = ref(false);
const config = ref({ publicBaseUrl: '' });
const qrOrg = ref(null);
const qrSize = ref(600);
const qrUrl = ref('');
const responses = ref([]);
const responseTotal = ref(0);
const page = ref(1);
const filters = ref({ startTime: '', endTime: '', orgCode: '', name: '', phone: '', fillerType: '' });
const detail = ref(null);
const loginRequired = computed(() => !token.value);
const invalidBaseUrl = computed(() => /localhost|127\.0\.0\.1/i.test(config.value.publicBaseUrl));
const allSelected = computed(() => orgs.value.length > 0 && orgs.value.every((org) => selected.value.includes(org.code)));

async function loadOrgs() {
  orgs.value = await request(`/admin/v1/orgs?keyword=${encodeURIComponent(keyword.value)}`);
}

async function loadConfig() {
  config.value = await request('/admin/v1/config');
}

async function loadResponses() {
  const params = new URLSearchParams({ page: String(page.value), size: '20' });
  Object.entries(filters.value).forEach(([key, value]) => { if (value) params.set(key, value); });
  const result = await request(`/admin/v1/responses?${params}`);
  responses.value = result.items;
  responseTotal.value = result.total;
}

async function initialize() {
  try {
    await Promise.all([loadConfig(), loadOrgs()]);
    await loadResponses();
  } catch (cause) {
    if (!getToken()) {
      token.value = '';
      loginError.value = cause.message;
      return;
    }
    error.value = cause.message;
  }
}

async function login() {
  loginError.value = '';
  try {
    const result = await request('/admin/v1/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    setToken(result.token);
    token.value = result.token;
    password.value = '';
    await initialize();
  } catch (cause) {
    loginError.value = cause.message;
  }
}

function logout() {
  clearToken();
  token.value = '';
  orgs.value = [];
  responses.value = [];
}

function openOrgForm(org = null) {
  orgFormOpen.value = true;
  orgFormError.value = '';
  editingOrgId.value = org?.id ?? null;
  orgForm.value = {
    name: org?.name ?? '',
    address: org?.address ?? '',
    code: ''
  };
}

function closeOrgForm() {
  orgFormOpen.value = false;
  editingOrgId.value = null;
  orgFormError.value = '';
}

async function saveOrg() {
  orgFormError.value = '';
  const editingId = editingOrgId.value;
  const payload = {
    name: orgForm.value.name.trim(),
    address: orgForm.value.address.trim()
  };
  if (!editingId) payload.code = orgForm.value.code.trim();
  savingOrg.value = true;
  try {
    const saved = editingId
      ? await request(`/admin/v1/orgs/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await request('/admin/v1/orgs', { method: 'POST', body: JSON.stringify(payload) });
    closeOrgForm();
    info.value = editingId ? `机构“${saved.name}”已更新` : `机构“${saved.name}”已创建`;
    await loadOrgs();
    if (!editingId) await showQr(saved);
  } catch (cause) {
    orgFormError.value = cause.message;
  } finally {
    savingOrg.value = false;
  }
}

async function editOrg(org) {
  openOrgForm(org);
}

async function toggleOrg(org) {
  const status = org.status === 1 ? 0 : 1;
  if (!window.confirm(`${status ? '启用' : '停用'}机构“${org.name}”？`)) return;
  try {
    await request(`/admin/v1/orgs/${org.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    await loadOrgs();
  } catch (cause) {
    error.value = cause.message;
  }
}

async function showQr(org) {
  qrOrg.value = org;
  await refreshQr();
}

async function refreshQr() {
  if (!qrOrg.value) return;
  try {
    const blob = await request(`/admin/v1/orgs/${encodeURIComponent(qrOrg.value.code)}/qrcode?size=${qrSize.value}`, { raw: true });
    if (qrUrl.value) URL.revokeObjectURL(qrUrl.value);
    qrUrl.value = URL.createObjectURL(blob);
  } catch (cause) {
    error.value = cause.message;
  }
}

async function downloadQr(org = qrOrg.value) {
  if (!org) return;
  try {
    const blob = await request(`/admin/v1/orgs/${encodeURIComponent(org.code)}/qrcode?size=${qrSize.value}&download=true`, { raw: true });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${org.name}_二维码.png`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (cause) {
    error.value = cause.message;
  }
}

async function downloadZip() {
  if (!selected.value.length) {
    error.value = '请先勾选需要下载二维码的机构';
    return;
  }
  try {
    const blob = await request('/admin/v1/orgs/qrcode-zip', {
      method: 'POST',
      body: JSON.stringify({ codes: selected.value, size: qrSize.value }),
      raw: true
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '机构二维码.zip';
    link.click();
    URL.revokeObjectURL(url);
  } catch (cause) {
    error.value = cause.message;
  }
}

async function copyQrLink() {
  const link = qrOrg.value.questionnaireUrl;
  try {
    await navigator.clipboard.writeText(link);
    info.value = '二维码链接已复制';
  } catch {
    window.prompt('请复制二维码链接', link);
  }
}

async function openDetail(row, revealPhone = false) {
  try {
    detail.value = await request(`/admin/v1/responses/${row.id}${revealPhone ? '?revealPhone=true' : ''}`);
  } catch (cause) {
    error.value = cause.message;
  }
}

async function exportExcel() {
  const params = new URLSearchParams();
  Object.entries(filters.value).forEach(([key, value]) => { if (value) params.set(key, value); });
  try {
    const blob = await request(`/admin/v1/responses/export?${params}`, { raw: true });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '四高问卷填写记录.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  } catch (cause) {
    error.value = cause.message;
  }
}

function toggleAll(event) {
  selected.value = event.target.checked ? orgs.value.map((org) => org.code) : [];
}

function formatTime(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').replace(/\.\d+Z?$/, '');
}

onMounted(() => {
  if (token.value) initialize();
});
</script>

<template>
  <main class="admin-shell">
    <section v-if="loginRequired" class="login-page">
      <form class="login-card" @submit.prevent="login">
        <p class="eyebrow">管理端</p><h1>四高问卷后台</h1>
        <label class="field-label">管理员账号<input v-model="username" autocomplete="username" required></label>
        <label class="field-label">登录密码<input v-model="password" type="password" autocomplete="current-password" required></label>
        <p v-if="loginError" class="error-text">{{ loginError }}</p>
        <button class="button primary full">登录</button>
      </form>
    </section>
    <template v-else>
      <header class="admin-topbar"><strong>四高问卷后台</strong><nav><button :class="{ active: activeTab === 'orgs' }" @click="activeTab = 'orgs'; error = ''">机构管理</button><button :class="{ active: activeTab === 'responses' }" @click="activeTab = 'responses'; error = ''">填写记录</button></nav><span class="admin-user">{{ getToken() ? '管理员' : '' }}</span><button class="text-button" @click="logout">退出</button></header>
      <div class="admin-content">
        <p v-if="error" class="notice error-notice">{{ error }} <button @click="error = ''">关闭</button></p>
        <p v-if="info" class="notice success-notice">{{ info }} <button @click="info = ''">关闭</button></p>
        <template v-if="activeTab === 'orgs'">
          <div class="public-url-banner">
            <span>二维码访问地址：<strong>{{ config.publicBaseUrl || '读取中…' }}</strong></span>
            <span v-if="invalidBaseUrl" class="url-warning">该地址手机无法访问，请联系管理员修改 PUBLIC_BASE_URL</span>
          </div>
          <div class="toolbar">
            <form class="search-form" @submit.prevent="loadOrgs"><input v-model="keyword" placeholder="搜索机构名称"><button class="button secondary">查询</button></form>
            <div class="toolbar-actions"><button class="button secondary" @click="downloadZip">批量下载二维码（{{ selected.length }}）</button><button class="button primary" @click="openOrgForm()">＋ 新增机构</button></div>
          </div>
          <div class="table-wrap"><table><thead><tr><th><input type="checkbox" :checked="allSelected" @change="toggleAll"></th><th>机构名称</th><th>机构地址</th><th>机构编码</th><th>状态</th><th>提交量</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
            <tr v-for="org in orgs" :key="org.id"><td><input v-model="selected" type="checkbox" :value="org.code"></td><td>{{ org.name }}</td><td class="address-cell">{{ org.address || '未填写' }}</td><td><code>{{ org.code }}</code></td><td><span class="status-pill" :class="{ disabled: org.status !== 1 }">{{ org.status === 1 ? '启用' : '停用' }}</span></td><td>{{ org.responseCount }}</td><td>{{ formatTime(org.createdAt) }}</td><td class="table-actions"><button class="text-button" @click="showQr(org)">二维码</button><button class="text-button" @click="editOrg(org)">编辑</button><button class="text-button" @click="toggleOrg(org)">{{ org.status === 1 ? '停用' : '启用' }}</button></td></tr>
            <tr v-if="!orgs.length"><td colspan="8" class="empty-row">暂无机构数据</td></tr>
          </tbody></table></div>
        </template>

        <template v-else>
          <h1 class="admin-heading">填写记录</h1>
          <form class="filters" @submit.prevent="page = 1; loadResponses()">
            <label>开始时间<input v-model="filters.startTime" type="datetime-local"></label><label>结束时间<input v-model="filters.endTime" type="datetime-local"></label>
            <label>机构<select v-model="filters.orgCode"><option value="">全部机构</option><option v-for="org in orgs" :key="org.code" :value="org.code">{{ org.name }}</option></select></label>
            <label>姓名<input v-model="filters.name" placeholder="患者姓名"></label><label>手机号<input v-model="filters.phone" placeholder="手机号"></label>
            <label>填写人<select v-model="filters.fillerType"><option value="">全部</option><option value="1">本人填写</option><option value="2">他人代填</option></select></label>
            <button class="button secondary">查询</button><button type="button" class="button primary" @click="exportExcel">导出 Excel</button>
          </form>
          <div class="table-wrap"><table><thead><tr><th>提交编号</th><th>姓名</th><th>性别</th><th>年龄</th><th>手机号</th><th>机构</th><th>填写人类型</th><th>填写时间</th><th>操作</th></tr></thead><tbody>
            <tr v-for="row in responses" :key="row.id"><td>{{ row.responseNo }}</td><td>{{ row.patientName }}</td><td>{{ row.gender === 'M' ? '男' : '女' }}</td><td>{{ row.age }}</td><td>{{ row.phone }}</td><td>{{ row.orgName }}</td><td>{{ row.fillerType === 1 ? '本人填写' : '他人代填' }}</td><td>{{ formatTime(row.submittedAt) }}</td><td><button class="text-button" @click="openDetail(row)">详情</button></td></tr>
            <tr v-if="!responses.length"><td colspan="9" class="empty-row">暂无记录</td></tr>
          </tbody></table></div>
          <div class="pagination"><span>共 {{ responseTotal }} 条</span><button class="button secondary" :disabled="page <= 1" @click="page--; loadResponses()">上一页</button><span>第 {{ page }} 页</span><button class="button secondary" :disabled="page * 20 >= responseTotal" @click="page++; loadResponses()">下一页</button></div>
        </template>
      </div>
    </template>

    <div v-if="orgFormOpen" class="modal-backdrop" @click.self="closeOrgForm">
      <section class="modal-card org-form-modal">
        <button class="modal-close" aria-label="关闭" @click="closeOrgForm">×</button>
        <h2>{{ editingOrgId ? '编辑机构' : '新增机构' }}</h2>
        <form @submit.prevent="saveOrg">
          <label class="field-label">机构名称<input v-model="orgForm.name" maxlength="100" required autocomplete="organization"></label>
          <label class="field-label">机构地址<input v-model="orgForm.address" maxlength="255" required autocomplete="street-address" placeholder="请输入省、市、区及详细地址"></label>
          <label v-if="editingOrgId === null" class="field-label">机构编码（选填）<input v-model="orgForm.code" maxlength="32" pattern="[A-Za-z0-9_]{2,32}" placeholder="留空时由系统自动生成"></label>
          <p v-if="editingOrgId === null" class="form-hint">机构二维码扫码后会直接打开该机构的问卷。</p>
          <p v-if="orgFormError" class="error-text" role="alert">{{ orgFormError }}</p>
          <div class="actions"><button type="button" class="button secondary" @click="closeOrgForm">取消</button><button class="button primary" :disabled="savingOrg">{{ savingOrg ? '正在保存…' : '保存机构' }}</button></div>
        </form>
      </section>
    </div>

    <div v-if="qrOrg" class="modal-backdrop" @click.self="qrOrg = null">
      <section class="modal-card qr-modal">
        <button class="modal-close" aria-label="关闭" @click="qrOrg = null">×</button><h2>{{ qrOrg.name }}</h2>
        <img v-if="qrUrl" :src="qrUrl" :width="Math.min(qrSize, 360)" :height="Math.min(qrSize, 360)" alt="机构问卷二维码">
        <p>微信扫一扫，填写健康问卷</p>
        <div class="size-options"><label v-for="size in [300, 600, 1200]" :key="size"><input v-model="qrSize" type="radio" :value="size" @change="refreshQr"> {{ size === 300 ? '小' : size === 600 ? '中' : '大' }}（{{ size }}px）</label></div>
        <div class="qr-link"><span>{{ qrOrg.questionnaireUrl }}</span><button class="text-button" @click="copyQrLink">复制链接</button></div>
        <button class="button primary full" @click="downloadQr()">下载 PNG</button>
      </section>
    </div>
    <div v-if="detail" class="modal-backdrop" @click.self="detail = null">
      <section class="modal-card detail-modal"><button class="modal-close" aria-label="关闭" @click="detail = null">×</button><h2>填写记录详情</h2>
        <p><strong>{{ detail.patientName }}</strong>　{{ detail.gender === 'M' ? '男' : '女' }}　{{ detail.age }}岁</p>
        <p>手机号：{{ detail.phone }} <button class="text-button" @click="openDetail(detail, true)">显示完整号码</button></p>
        <p>机构：{{ detail.orgName }}　填写时间：{{ formatTime(detail.submittedAt) }}</p>
        <div v-for="answer in detail.answers" :key="answer.field" class="detail-answer"><span>{{ answer.label }}</span><strong>{{ answer.value }}</strong></div>
      </section>
    </div>
  </main>
</template>
