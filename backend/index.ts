import { router, json, error, db } from '@appdeploy/sdk';
import { notifySubscribers, realtimeSubscriptionRoutes } from './realtime-subscribers';

type PlayerInput = {
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  connection_id?: string;
};

export const handler = router({
  'GET /api/players': [async () => {
    const { items } = await db.list('galaxy_players', { limit: 100 });
    const cutoff = Date.now() - 20000;
    return json({ players: items.filter(player => Number(player.updated_at) > cutoff) });
  }],
  'POST /api/players': [async ({ body }) => {
    const input = (body || {}) as PlayerInput;
    const id = String(input.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const name = String(input.name || 'Pilot').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 20) || 'Pilot';
    const values = [input.x, input.y, input.z, input.yaw, input.pitch];
    if (!id || values.some(value => !Number.isFinite(Number(value)))) return error('Invalid player telemetry', 400);
    const record = { id, name, x: Number(input.x), y: Number(input.y), z: Number(input.z), yaw: Number(input.yaw), pitch: Number(input.pitch), updated_at: Date.now() };
    const [created] = await db.tx.add('galaxy_players', [record]);
    if (!created) {
      const [updated] = await db.tx.update('galaxy_players', [{ id, record, if: { id } }], { patch: true });
      if (!updated) return error('Could not update pilot telemetry', 409);
    }
    await notifySubscribers('galaxy', 'main', { ...record, removed: false }, input.connection_id);
    return json({ ok: true });
  }],
  'DELETE /api/players/:id': [async ({ params }) => {
    const id = String(params.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!id) return error('Invalid pilot id', 400);
    await db.delete('galaxy_players', [id]);
    await notifySubscribers('galaxy', 'main', { id, removed: true });
    return json({ ok: true });
  }],
  ...realtimeSubscriptionRoutes,
});
