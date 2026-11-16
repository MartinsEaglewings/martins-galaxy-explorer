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

  delete(path: string, body?: unknown) {
    return this.request('DELETE', path, body);
  },
};

const ws = {
  connect(pilotId?: string, pilotName?: string) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

    let socket: WebSocket | null = null;
    let currentConnectionId = '';
    let connected = false;
    let stopped = false;
    let retryTimer = 0;
    let retryCount = 0;

    let messageHandler: ((message: any) => void) | undefined;
    let closeHandler: (() => void) | undefined;
    let errorHandler: (() => void) | undefined;
    let readyHandler: ((connectionId: string) => void) | undefined;

    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => {
      resolveReady = resolve;
    });

    const makeConnectionId = () =>
      'pilot-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);

    const scheduleReconnect = () => {
      if (stopped || retryTimer) return;

      const delay = Math.min(15000, 1000 * Math.pow(1.7, retryCount));
      retryCount += 1;

      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        openSocket();
      }, delay);
    };

    const openSocket = () => {
      if (stopped) return;

      let nextSocket: WebSocket;

      try {
        nextSocket = new WebSocket(`${protocol}//${location.host}/ws`);
      } catch {
        errorHandler?.();
        scheduleReconnect();
        return;
      }

      socket = nextSocket;

      nextSocket.addEventListener('open', () => {
        if (stopped || socket !== nextSocket) {
          nextSocket.close();
          return;
        }

        currentConnectionId = makeConnectionId();

        try {
          nextSocket.send(JSON.stringify({
            type: 'hello',
            connection_id: currentConnectionId,
            pilot_id: pilotId || '',
            pilot_name: pilotName || '',
          }));

          connected = true;
          retryCount = 0;
          resolveReady();
          readyHandler?.(currentConnectionId);
        } catch {
          nextSocket.close();
        }
      });

      nextSocket.addEventListener('message', event => {
        if (socket !== nextSocket) return;

        try {
          const message = JSON.parse(event.data);
          messageHandler?.(message);
        } catch {
          // Ignore malformed messages.
        }
      });

      nextSocket.addEventListener('close', () => {
        if (socket !== nextSocket) return;

        connected = false;
        currentConnectionId = '';
        closeHandler?.();
        scheduleReconnect();
      });

      nextSocket.addEventListener('error', () => {
        if (socket !== nextSocket) return;
        errorHandler?.();
      });
    };

    openSocket();

    return {
      get connectionId() {
        return currentConnectionId;
      },

      get isConnected() {
        return connected && socket?.readyState === WebSocket.OPEN;
      },

      ready,

      onMessage(callback: (message: any) => void) {
        messageHandler = callback;
      },

      onReady(callback: (connectionId: string) => void) {
        readyHandler = callback;
        if (connected && currentConnectionId) {
          callback(currentConnectionId);
        }
      },

      onClose(callback: () => void) {
        closeHandler = callback;
      },

      onError(callback: () => void) {
        errorHandler = callback;
      },

      send(message: unknown) {
        if (!connected || socket?.readyState !== WebSocket.OPEN) {
          return false;
        }

        try {
          socket.send(JSON.stringify(message));
          return true;
        } catch {
          return false;
        }
      },

      disconnect() {
        stopped = true;
        connected = false;
        currentConnectionId = '';

        if (retryTimer) {
          window.clearTimeout(retryTimer);
          retryTimer = 0;
        }

        const activeSocket = socket;
        socket = null;
        activeSocket?.close();
      },
    };
  },
};

export { api, ws };
