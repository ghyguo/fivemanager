<script setup>
import { onMounted, ref } from 'vue';
import { request } from '../api.js';

const organizations = ref([]);
const publicBaseUrl = ref('');
const loading = ref(true);
const error = ref('');
const invalidBaseUrl = ref(false);

async function loadOrganizations() {
  loading.value = true;
  error.value = '';
  try {
    const [loadedOrganizations, config] = await Promise.all([
      request('/v1/orgs'),
      request('/v1/config')
    ]);
    organizations.value = loadedOrganizations;
    publicBaseUrl.value = config.publicBaseUrl ?? '';
    invalidBaseUrl.value = /localhost|127\.0\.0\.1/i.test(publicBaseUrl.value);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadOrganizations);
</script>

<template>
  <main class="patient-home">
    <header class="patient-home-header">
      <p class="eyebrow">健康问卷</p>
      <h1>微信扫一扫，开始填写</h1>
      <p>请选择对应机构，使用微信扫描二维码，手机将直接打开该机构的问卷。</p>
      <p v-if="invalidBaseUrl" class="home-url-warning">二维码访问地址当前配置为 {{ publicBaseUrl }}，外部手机无法访问。请联系工作人员配置可访问的 PUBLIC_BASE_URL。</p>
    </header>

    <section v-if="loading" class="panel centered"><p>正在加载机构二维码…</p></section>
    <section v-else-if="error" class="panel centered">
      <p class="error-text" role="alert">{{ error }}</p>
      <button class="button secondary" @click="loadOrganizations">重新加载</button>
    </section>
    <section v-else-if="!organizations.length" class="panel centered">
      <p>当前没有可填写问卷的机构，请联系工作人员。</p>
    </section>
    <section v-else class="organization-qr-list">
      <article v-for="organization in organizations" :key="organization.code" class="organization-qr-card">
        <img
          :src="`/api/v1/orgs/${encodeURIComponent(organization.code)}/qrcode`"
          :alt="`${organization.name}问卷二维码`"
        >
        <div class="organization-qr-info">
          <h2>{{ organization.name }}</h2>
          <p v-if="organization.address">{{ organization.address }}</p>
          <a class="button primary" :href="organization.questionnaireUrl">直接打开问卷</a>
        </div>
      </article>
    </section>

    <footer class="site-footer">请核对机构后再开始填写</footer>
  </main>
</template>
