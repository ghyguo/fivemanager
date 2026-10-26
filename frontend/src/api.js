const API = '/api';
const TOKEN_KEY = 'fourhigh_admin_token';
let memoryToken = '';

async function readJsonResponse(response) {
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = /text\/html/i.test(contentType) || /^\s*<(?:!doctype|html|head|body)\b/i.test(body);
    if (isHtml) {
      throw new Error(`API 服务暂不可用（HTTP ${response.status}），收到网页错误页。请检查后端 API 服务状态和 /api 反向代理配置。`);
    }
    throw new Error(`API 响应格式无效（HTTP ${response.status}），请检查后端 API 服务。`);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`API 响应格式无效（HTTP ${response.status}），请检查后端 API 服务。`);
  }
  return result;
}

export function getToken() {
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    return memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setToken(token) {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // An in-memory token remains usable for this page session.
  }
}

export function clearToken() {
  memoryToken = '';
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // The current page will still return to the login form.
  }
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API}${path}`, { ...options, headers });
  if (response.status === 401 && path !== '/admin/v1/login') clearToken();
  if (options.raw) {
    if (!response.ok) {
      const result = await readJsonResponse(response);
      throw new Error(result?.message ?? '请求失败，请重试');
    }
    if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error(`API 服务暂不可用（HTTP ${response.status}），收到网页错误页。请检查后端 API 服务状态和 /api 反向代理配置。`);
    }
    return response.blob();
  }
  const result = await readJsonResponse(response);
  if (!response.ok || result.code !== 0) {
    const firstError = result?.data?.errors?.[0]?.message;
    throw new Error(firstError ?? result?.message ?? '请求失败，请重试');
  }
  return result.data;
}
