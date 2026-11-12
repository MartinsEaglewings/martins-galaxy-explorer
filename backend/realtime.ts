import { removeSubscriptionsByConnection } from './realtime-subscribers';

export const realtime = async (event: any) => {
  let message: any = {};
  try { message = JSON.parse(event.body || '{}'); } catch {}
  const connectionId = message.payload?.connection_id;
  if (message.type === 'system.disconnected' && connectionId) {
    await removeSubscriptionsByConnection(connectionId);
  }
  return { statusCode: 200 };
};
