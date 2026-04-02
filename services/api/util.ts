import { debugLog } from '@/utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emitAccessTokenRefreshed } from './authEvents';

// API設定
export interface API_SETTINGS {
  BASE_URL: string;
  TIMEOUT: number;
}

// 請求頭類型
export interface RequestHeaders {
  'Content-Type': string;
  'Authorization'?: string;
  'Accept': string;
  [key: string]: string | undefined;
}

// 後端統一回應格式
export interface MetaInfo {
  request_id: string;
}

export interface ApiSuccessResponse<T = any> {
  data: T;
  meta?: MetaInfo;
}

export interface ApiErrorInfo {
  code: string;
  message: string;
  details?: any;
}

export interface ApiErrorResponse {
  error: ApiErrorInfo;
  meta?: MetaInfo;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: any;
  requestId?: string;
  raw?: any;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string;
      details?: any;
      requestId?: string;
      raw?: any;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.requestId = opts.requestId;
    this.raw = opts.raw;
  }
}

const getApiBaseUrl = (): string => {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!raw) {
    throw new ApiError(
      '缺少 API 設定：請在 .env.local 設定 EXPO_PUBLIC_API_BASE_URL',
      {
        status: 500,
        code: 'CONFIG_MISSING_API_BASE_URL',
      }
    );
  }
  return raw.replace(/\/+$/, '');
};

// 請求配置類型
export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Partial<RequestHeaders>;
  body?: any;
  timeout?: number;
  requireAuth?: boolean;
}

const parseBody = async (res: Response): Promise<any> => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// 成功回應：若後端已包 {data, meta} 就直接用；否則包成 {data}
const normalizeSuccess = <T = any>(raw: any): ApiSuccessResponse<T> => {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return raw as ApiSuccessResponse<T>;
  }
  return { data: raw as T };
};

const extractError = (status: number, raw: any): ApiError => {
  const requestId =
    raw && typeof raw === 'object' ? (raw as any)?.meta?.request_id : undefined;

  if (raw && typeof raw === 'object' && 'error' in raw) {
    const info = (raw as any).error as ApiErrorInfo | undefined;
    return new ApiError(info?.message || `HTTP error! status: ${status}`, {
      status,
      code: info?.code,
      details: info?.details,
      requestId,
      raw,
    });
  }

  const msg =
    typeof raw === 'string'
      ? raw
      : raw?.message
        ? String(raw.message)
        : `HTTP error! status: ${status}`;

  return new ApiError(msg, { status, requestId, raw });
};

// 獲取認證token
const getAuthToken = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem('authToken');
  } catch (error) {
    console.error('獲取認證token失敗:', error);
    return null;
  }
};

// 獲取刷新token
const getRefreshToken = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem('refreshToken');
  } catch (error) {
    console.error('獲取刷新token失敗:', error);
    return null;
  }
};

// 刷新token
const refreshAuthToken = async (): Promise<string | null> => {
  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      console.error('❌ 沒有找到刷新token');
      return null;
    }

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/auth/refresh`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      console.error('❌ 刷新token失敗:', response.status);
      return null;
    }

    const result = await parseBody(response);
    const accessToken = result?.data?.access_token;
    if (accessToken) {
      // 保存新的access token
      await AsyncStorage.setItem('authToken', accessToken);
      const refresh = result?.data?.refresh_token;
      if (refresh) {
        await AsyncStorage.setItem('refreshToken', refresh);
      }
      debugLog('✅ Token刷新成功');
      emitAccessTokenRefreshed(accessToken);
      return accessToken;
    }

    return null;
  } catch (error) {
    console.error('❌ 刷新token時發生錯誤:', error);
    return null;
  }
};

export const requestRaw = async (
  endpoint: string,
  config: RequestConfig
): Promise<Response> => {
  const { method = 'POST', headers, body, requireAuth = false } = config;
  const baseUrl = getApiBaseUrl();

  debugLog(`🌐 API 請求: ${method} ${endpoint}`);
  debugLog(`🔐 需要認證: ${requireAuth}`);
  
  // 構建請求頭
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...headers,
  };

  // 如果需要認證，自動添加 Authorization header
  if (requireAuth) {
    const token = await getAuthToken();
    debugLog(`🔑 Token 狀態: ${token ? '已找到' : '未找到'}`);
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
      debugLog(`✅ 已添加 Authorization header`);
    } else {
      console.error('❌ 需要認證但未找到有效的 access_token');
      throw new Error('需要認證但未找到有效的 access_token');
    }
  }

  const url = `${baseUrl}${endpoint}`;

  // 構建 fetch 配置
  const fetchConfig: RequestInit = {
    method,
    headers: requestHeaders,
  };

  // 只有在非 GET 請求時才設置 body
  if (body && method !== 'GET') {
    fetchConfig.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchConfig);

  // 如果是401錯誤且需要認證，嘗試刷新token
  if (response.status === 401 && requireAuth) {
    debugLog('🔄 Token已過期，嘗試刷新...');
    const newToken = await refreshAuthToken();
    
    if (newToken) {
      // 使用新token重新發送請求
      const newHeaders = {
        ...requestHeaders,
        Authorization: `Bearer ${newToken}`,
      };
      
      const newFetchConfig: RequestInit = {
        method,
        headers: newHeaders,
      };
      
      if (body && method !== 'GET') {
        newFetchConfig.body = JSON.stringify(body);
      }
      
      const retryResponse = await fetch(url, newFetchConfig);
      
      if (!retryResponse.ok) {
        const raw = await parseBody(retryResponse);
        console.error(`❌ 重試請求後仍失敗: ${retryResponse.status}`, raw);
        throw extractError(retryResponse.status, raw);
      }

      debugLog(`✅ API 響應成功 (使用新token): ${method} ${endpoint}`);
      return retryResponse;
    } else {
      console.error('❌ 無法刷新token，需要重新登入');
      throw new ApiError('登入已過期，請重新登入', {
        status: 401,
        code: 'TOKEN_EXPIRED',
      });
    }
  }

  if (!response.ok) {
    const raw = await parseBody(response);
    console.error(`❌ HTTP 錯誤: ${response.status}`, raw);
    throw extractError(response.status, raw);
  }

  debugLog(`✅ API 響應成功: ${method} ${endpoint}`);
  return response;
};

// 簡潔的請求函數
export const request = async <T>(
  endpoint: string,
  config: RequestConfig
): Promise<ApiSuccessResponse<T>> => {
  const response = await requestRaw(endpoint, config);
  const result = await parseBody(response);
  debugLog(`✅ API 響應成功:`, result);
  return normalizeSuccess<T>(result);
};
