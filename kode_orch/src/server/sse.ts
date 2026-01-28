import type { ServerResponse } from 'node:http';

export interface SSEEvent {
  type:
    | 'text' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_error'
    | 'approval_needed' | 'progress' | 'phase' | 'done' | 'error'
    | 'orchestrator_start' | 'orchestrator_text' | 'orchestrator_done';
  data: unknown;
}

export class SSEManager {
  private connections: Set<ServerResponse> = new Set();

  addConnection(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    this.connections.add(res);
    res.on('close', () => this.connections.delete(res));
  }

  send(event: SSEEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const conn of this.connections) {
      if (!conn.destroyed) {
        conn.write(data);
      }
    }
  }

  sendTo(res: ServerResponse, event: SSEEvent): void {
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  endAll(): void {
    for (const conn of this.connections) {
      if (!conn.destroyed) conn.end();
    }
    this.connections.clear();
  }

  get connectionCount(): number {
    return this.connections.size;
  }
}
