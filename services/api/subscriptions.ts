import { ApiSuccessResponse, request, requestRaw } from './util';

export interface DeviceInfo {
  fcm_token: string;
  device_id: string;
  platform: string;
}

export interface SubscribeMerchantRequest {
  merchant_id: string;
  device_info?: DeviceInfo;
}

export interface ProcessQRSubscriptionRequest {
  qr_data: string;
  device_info?: DeviceInfo;
}

export interface UserMerchantSubscription {
  id: string;
  user_id: string;
  merchant_id: string;
  is_active: boolean;
  notification_radius: number; // meters
  subscribed_at: string;
  updated_at: string;
  merchant_name?: string;
  store_name?: string;
  merchant?: {
    name?: string;
    store_name?: string;
    merchant_name?: string;
  };
  merchant_profile?: {
    name?: string;
    store_name?: string;
  };
}

export interface UnsubscribeMerchantData {
  message: string;
}

export type SubscribeMerchantResponse = ApiSuccessResponse<UserMerchantSubscription>;
export type UnsubscribeMerchantResponse = ApiSuccessResponse<UnsubscribeMerchantData>;
export type GetSubscriptionsResponse = ApiSuccessResponse<UserMerchantSubscription[]>;
export type ProcessQRSubscriptionResponse = ApiSuccessResponse<UserMerchantSubscription>;

export const subscriptionsApi = {
  // 訂閱攤商（POST /api/v1/subscriptions）
  subscribeMerchant: (body: SubscribeMerchantRequest) => {
    return request<UserMerchantSubscription>('/api/v1/subscriptions', {
      requireAuth: true,
      method: 'POST',
      body,
    }) as Promise<SubscribeMerchantResponse>;
  },
  // 取消訂閱（DELETE /api/v1/subscriptions/:merchantId）
  unsubscribeMerchant: (merchantId: string) => {
    return request<UnsubscribeMerchantData>(`/api/v1/subscriptions/${merchantId}`, {
      requireAuth: true,
      method: 'DELETE',
    }) as Promise<UnsubscribeMerchantResponse>;
  },
  // 取得訂閱列表（GET /api/v1/subscriptions）
  getSubscriptions: () => {
    return request<UserMerchantSubscription[]>(`/api/v1/subscriptions`, {
      requireAuth: true,
      method: 'GET',
    }) as Promise<GetSubscriptionsResponse>;
  },
  // 掃碼訂閱（POST /api/v1/subscriptions/qr）
  processQRSubscription: (body: ProcessQRSubscriptionRequest) => {
    return request<UserMerchantSubscription>('/api/v1/subscriptions/qr', {
      requireAuth: true,
      method: 'POST',
      body,
    }) as Promise<ProcessQRSubscriptionResponse>;
  },
  // 取得攤商自己的訂閱 QR Code（GET /api/v1/merchant/qr）
  getMerchantQrCode: () => {
    return requestRaw('/api/v1/merchant/qr', {
      requireAuth: true,
      method: 'GET',
      headers: {
        Accept: 'image/png',
      },
    });
  },
};
