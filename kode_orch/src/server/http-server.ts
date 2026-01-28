import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { handleChat, handleCommand, handleStatus, handleHistory, handleApproval, handleSandboxDispose, handleBgTasksList, type RouteContext } from './routes.js';
import { logger } from '../utils/logger.js';

export function startServer(port: number, authToken: string, ctx: RouteContext): void {
  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const path = url.pathname;

    // Auth check for API routes (except /api/events which uses query param)
    if (path.startsWith('/api/') && path !== '/api/events') {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    try {
      // Route dispatch
      if (path === '/' && req.method === 'GET') {
        await serveStaticHtml(res);
      } else if (path === '/api/chat' && req.method === 'POST') {
        await handleChat(req, res, ctx);
      } else if (path === '/api/command' && req.method === 'POST') {
        await handleCommand(req, res, ctx);
      } else if (path === '/api/events' && req.method === 'GET') {
        // EventSource 不支持自定义 header，从 query 取 token
        const qToken = url.searchParams.get('token');
        if (!qToken || qToken !== authToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        ctx.sseManager.addConnection(res);
      } else if (path === '/api/status' && req.method === 'GET') {
        handleStatus(req, res, ctx);
      } else if (path === '/api/history' && req.method === 'GET') {
        await handleHistory(req, res, ctx);
      } else if (path === '/api/approval' && req.method === 'POST') {
        await handleApproval(req, res, ctx);
      } else if (path === '/api/sandbox/dispose' && req.method === 'POST') {
        await handleSandboxDispose(req, res, ctx);
      } else if (path === '/api/bg-tasks' && req.method === 'GET') {
        await handleBgTasksList(req, res, ctx);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (err) {
      logger.error('http', 'Request error', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      if (!res.destroyed) {
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  });

  server.listen(port, () => {
    logger.info('http', `Server listening on http://localhost:${port}`);
  });
}

async function serveStaticHtml(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(process.cwd(), 'public', 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('index.html not found');
  }
}
