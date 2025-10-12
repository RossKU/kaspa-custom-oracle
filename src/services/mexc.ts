// MEXC Futures WebSocket - Minimal Test
const MEXC_WS_URL = 'wss://contract.mexc.com/edge';

export class MexcWebSocketTest {
  private ws: WebSocket | null = null;

  connect() {
    console.log('[MEXC] Connecting to', MEXC_WS_URL);

    this.ws = new WebSocket(MEXC_WS_URL);

    this.ws.onopen = () => {
      console.log('[MEXC] ✅ Connected!');

      // Send PING
      this.sendPing();
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[MEXC] Received:', data);
    };

    this.ws.onerror = (error) => {
      console.error('[MEXC] ❌ Error:', error);
    };

    this.ws.onclose = () => {
      console.log('[MEXC] Connection closed');
    };
  }

  private sendPing() {
    const pingMessage = {
      method: 'ping'
    };

    console.log('[MEXC] Sending PING:', pingMessage);
    this.ws?.send(JSON.stringify(pingMessage));
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
