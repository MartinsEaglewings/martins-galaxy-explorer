const api = {
  async request(method: string, path: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return { data };
  },

  get(path: string) {
    return this.request('GET', path);
  },

  post(path: string, body: unknown) {
    return this.request('POST', path, body);
  },

  delete(path: string) {
    return this.request('DELETE', path);
  },
};

const ws = {
  connect(pilotId?: string, pilotName?: string) {
    const connectionId =
      'pilot-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);

    let messageHandler: ((message: any) => void) | undefined;
    let closeHandler: (() => void) | undefined;
    let errorHandler: (() => void) | undefined;

    const ready = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          type: 'hello',
          connection_id: connectionId,
          pilot_id: pilotId || '',
          pilot_name: pilotName || '',
        }));
        resolve();
      }, { once: true });

      socket.addEventListener('error', () => {
        reject(new Error('Multiplayer connection failed'));
      }, { once: true });
    });

    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        messageHandler?.(message);
      } catch {
        // Ignore malformed messages.
      }
    });

    socket.addEventListener('close', () => closeHandler?.());
    socket.addEventListener('error', () => errorHandler?.());

    return {
      connectionId,
      ready,
      onMessage(callback: (message: any) => void) {
        messageHandler = callback;
      },
      onClose(callback: () => void) {
        closeHandler = callback;
      },
      onError(callback: () => void) {
        errorHandler = callback;
      },
      send(message: unknown) {
        if (socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
      },
      disconnect() {
        socket.close();
      },
    };
  },
};

export { api, ws };
