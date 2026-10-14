import {
  cartSessionIdFromRequest,
  jsonResponse,
} from './_shared/commerce.mjs';
import {
  recordAnalyticsEvent,
  validateAnalyticsEvent,
} from './_shared/sale-pulse.mjs';

export function createAnalyticsEventHandler({ recordEvent = recordAnalyticsEvent } = {}) {
  return async function handler(request) {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método no permitido.' }, 405);
    }

    try {
      const body = await request.json();
      const event = validateAnalyticsEvent(body);
      const result = await recordEvent({
        sessionId: cartSessionIdFromRequest(request),
        event,
      });
      return jsonResponse({ ok: true, accepted: result.accepted });
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : 'El evento no es válido.',
      }, Number(error?.status || 400));
    }
  };
}

export default createAnalyticsEventHandler();
