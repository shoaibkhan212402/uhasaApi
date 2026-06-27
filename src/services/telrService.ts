import { config } from '../config.js';

const TELR_GATEWAY = 'https://secure.telr.com/gateway/order.json';

export interface TelrCreateOrderParams {
  cartId: string;
  amount: number;
  currency?: string;
  description: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  returnAuthorisedUrl: string;
  returnDeclinedUrl: string;
  returnCancelledUrl: string;
}

export interface TelrCreateOrderResult {
  orderRef: string;
  paymentUrl: string;
}

export interface TelrCheckOrderResult {
  statusCode: number;
  statusText: string;
  raw: Record<string, unknown>;
}

function assertTelrConfigured() {
  if (!config.telr.storeId || !config.telr.authKey) {
    throw new Error(
      'Telr payment gateway is not configured. Set TELR_STORE_ID and TELR_AUTH_KEY in the server environment.'
    );
  }
}

export function isTelrConfigured(): boolean {
  return Boolean(config.telr.storeId && config.telr.authKey);
}

export async function createTelrOrder(params: TelrCreateOrderParams): Promise<TelrCreateOrderResult> {
  assertTelrConfigured();

  const payload = {
    method: 'create',
    store: Number(config.telr.storeId),
    authkey: config.telr.authKey,
    framed: 0,
    order: {
      cartid: params.cartId,
      test: config.telr.testMode ? '1' : '0',
      amount: params.amount.toFixed(2),
      currency: params.currency || 'AED',
      description: params.description.slice(0, 64),
    },
    return: {
      authorised: params.returnAuthorisedUrl,
      declined: params.returnDeclinedUrl,
      cancelled: params.returnCancelledUrl,
    },
    customer: {
      email: params.customerEmail,
      name: {
        forenames: (params.customerName || 'Customer').slice(0, 50),
      },
      ...(params.customerPhone ? { phone: params.customerPhone } : {}),
    },
  };

  const res = await fetch(TELR_GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    error?: { message?: string; note?: string };
    order?: { ref?: string; url?: string };
  };

  if (!res.ok || data.error) {
    const message = data.error?.message || data.error?.note || 'Telr payment session creation failed';
    throw new Error(message);
  }

  if (!data.order?.ref || !data.order?.url) {
    throw new Error('Telr did not return a payment URL');
  }

  return {
    orderRef: data.order.ref,
    paymentUrl: data.order.url,
  };
}

export async function checkTelrOrder(orderRef: string): Promise<TelrCheckOrderResult> {
  assertTelrConfigured();

  const payload = {
    method: 'check',
    store: Number(config.telr.storeId),
    authkey: config.telr.authKey,
    order: {
      ref: orderRef,
    },
  };

  const res = await fetch(TELR_GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    order?: {
      status?: { code?: number; text?: string };
    };
  };

  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Telr payment verification failed');
  }

  const statusCode = Number(data.order?.status?.code ?? -99);
  const statusText = data.order?.status?.text || 'Unknown';

  return {
    statusCode,
    statusText,
    raw: data as Record<string, unknown>,
  };
}

/** Telr status codes: 3 = authorised, -1 = declined, -2 = cancelled */
export function isTelrPaymentAuthorized(statusCode: number): boolean {
  return statusCode === 3;
}

export function isTelrPaymentCancelled(statusCode: number): boolean {
  return statusCode === -2;
}
