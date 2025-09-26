import axios, { type AxiosError } from 'axios';

type CurrencyCode = 'USD' | string;

export interface OrderItem {
  name: string;
  price: number;
  quantity?: number;
  description?: string;
}

interface CreateOrderResponse {
  orderId: string;
  checkout_url: string;
}

const GHL_API_BASE_URL = 'https://rest.gohighlevel.com/v1';
const MAX_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createOrder(
  locationId: string,
  contactId: string,
  currency: CurrencyCode,
  orderItems: OrderItem[],
  totalAmount: number,
  notes: string,
): Promise<CreateOrderResponse> {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY is not configured');
  }

  const client = axios.create({
    baseURL: GHL_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  const payload = {
    locationId,
    contactId,
    order: {
      status: 'unpaid',
      currency,
      orderItems: orderItems.map((item) => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity ?? 1,
        description: item.description,
      })),
      totalAmount,
      notes,
    },
  };

  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      const response = await client.post('/orders/', payload);
      const data = response.data ?? {};

      const orderId: string = data.orderId ?? data.order?.id ?? '';
      const checkoutUrl: string =
        data.checkout_url ?? data.checkoutUrl ?? data.order?.checkoutUrl ?? '';

      if (!orderId || !checkoutUrl) {
        console.error('Unexpected GHL response payload', {
          status: response.status,
          attempt,
        });
      }

      return {
        orderId,
        checkout_url: checkoutUrl,
      };
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const status = axiosError.response?.status;
      const isTransient = status != null && status >= 500 && status < 600;

      console.error('GHL order creation failed', {
        status,
        attempt,
      });

      if (isTransient && attempt < MAX_RETRIES) {
        const backoffMs = 200 * 2 ** attempt;
        await delay(backoffMs);
        attempt += 1;
        continue;
      }

      const message = axiosError.response?.data?.message ?? axiosError.message ?? 'GHL API error';
      const err = new Error(message);
      (err as { status?: number }).status = status;
      throw err;
    }
  }

  const finalError = new Error('Failed to create order after retries');
  (finalError as { status?: number }).status = 502;
  throw finalError;
}
