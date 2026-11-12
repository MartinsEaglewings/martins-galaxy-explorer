import { db, ws, json, error } from '@appdeploy/sdk';

type Subscription = { id: string; entity_type: string; entity_id: string; connection_id: string };

async function subscriptions() {
  const { items } = await db.list<Subscription>('entity_subscriptions', { limit: 1000 });
  return items;
}

export async function removeSubscriptionsByConnection(connectionId: string) {
  const matches = (await subscriptions()).filter(item => item.connection_id === connectionId);
  if (matches.length) await db.delete('entity_subscriptions', matches.map(item => item.id));
}

async function addSubscription(entityType: string, entityId: string, connectionId: string) {
  await db.add('entity_subscriptions', [{ entity_type: entityType, entity_id: entityId, connection_id: connectionId, created_at: Date.now() }]);
}

async function removeSubscription(entityType: string, entityId: string, connectionId: string) {
  const matches = (await subscriptions()).filter(item => item.entity_type === entityType && item.entity_id === entityId && item.connection_id === connectionId);
  if (matches.length) await db.delete('entity_subscriptions', matches.map(item => item.id));
}

export async function notifySubscribers(entityType: string, entityId: string, payload: unknown, excludeConnectionId?: string) {
  const targets = Array.from(new Set((await subscriptions())
    .filter(item => item.entity_type === entityType && item.entity_id === entityId && item.connection_id !== excludeConnectionId)
    .map(item => item.connection_id)));
  if (targets.length) await ws.send(targets, { v: 1, type: 'entity.update', payload: { entity_type: entityType, entity_id: entityId, data: payload } });
}

export const realtimeSubscriptionRoutes = {
  'POST /api/subscriptions': [async ({ body }) => {
    const input = (body || {}) as Record<string, string>;
    if (!input.entity_type || !input.entity_id || !input.connection_id) return error('Missing subscription details', 400);
    await addSubscription(input.entity_type, input.entity_id, input.connection_id);
    return json({ ok: true });
  }],
  'POST /api/subscriptions/remove': [async ({ body }) => {
    const input = (body || {}) as Record<string, string>;
    if (!input.entity_type || !input.entity_id || !input.connection_id) return error('Missing subscription details', 400);
    await removeSubscription(input.entity_type, input.entity_id, input.connection_id);
    return json({ ok: true });
  }],
};
