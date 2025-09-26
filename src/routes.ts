import { Router, type Request, type Response } from 'express';

import { createOrder, type OrderItem } from './ghlClient.js';

interface CreateFinalOrderRequest {
  locationId?: string;
  contactId?: string;
  eventDate?: string;
  bookingType?: string;
  balanceDue?: number | string;
  securityDeposit?: number | string;
  currency?: string;
  addOnsTotal?: number | string;
  addOnsDetails?: string;
}

export const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  return res.status(200).json({ status: 'ok' });
});

router.post(
  '/create-final-order',
  async (
    req: Request<unknown, unknown, CreateFinalOrderRequest>,
    res: Response,
  ): Promise<Response> => {
    const internalToken = req.header('x-internal-token');
    const expectedToken = process.env.INTERNAL_TOKEN;

    if (!internalToken || !expectedToken || internalToken !== expectedToken) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const {
      locationId,
      contactId,
      eventDate,
      bookingType,
      balanceDue,
      securityDeposit,
      currency = 'USD',
      addOnsTotal = 0,
      addOnsDetails = '',
    } = req.body ?? {};

    if (!locationId || !contactId || balanceDue == null || securityDeposit == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const parsedBalanceDue = Number(balanceDue);
    const parsedSecurityDeposit = Number(securityDeposit);
    const parsedAddOnsTotal = Number(addOnsTotal) || 0;

    if (
      [parsedBalanceDue, parsedSecurityDeposit, parsedAddOnsTotal].some(
        (value) => Number.isNaN(value) || !Number.isFinite(value),
      )
    ) {
      return res.status(400).json({ error: 'Invalid numeric values' });
    }

    const orderItems: OrderItem[] = [
      {
        name: `Final Balance — ${eventDate ?? 'Event Date TBD'} — ${bookingType ?? 'Booking'}`,
        price: parsedBalanceDue,
        quantity: 1,
      },
      {
        name: 'Refundable Security Deposit',
        price: parsedSecurityDeposit,
        quantity: 1,
      },
    ];

    if (parsedAddOnsTotal > 0) {
      orderItems.push({
        name: `Add-Ons${addOnsDetails ? ` — ${addOnsDetails}` : ''}`,
        price: parsedAddOnsTotal,
        quantity: 1,
      });
    }

    const totalAmount = parsedBalanceDue + parsedSecurityDeposit + parsedAddOnsTotal;
    const notes =
      'Final balance + refundable $500 deposit. Surcharge handled by processor; ACH $0. Deposit refunded within 10 days.';

    try {
      const { orderId, checkout_url } = await createOrder(
        locationId,
        contactId,
        currency,
        orderItems,
        totalAmount,
        notes,
      );

      return res.status(200).json({ orderId, checkout_url });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const safeStatus = status >= 400 && status < 600 ? status : 500;
      const message = (error as Error).message || 'Unexpected error';

      console.error('Failed to create order', { message });
      return res.status(safeStatus).json({
        error: 'Failed to create order',
        details: message,
      });
    }
  },
);
