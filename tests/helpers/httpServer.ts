/**
* Minimal HTTP server exposing the `/message` endpoint for local development
* and integration tests.
*
* The implementation deliberately avoids any external web-framework
* dependency (Express, Fastify, …) to keep the production bundle light and
* sidestep additional transitive dependencies. Node's built-in `http` module
* is perfectly adequate for the simple JSON POST that our tests run.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createServer as createNodeServer, IncomingMessage, ServerResponse } from 'http';

// Re-use the existing ChatBot.onMessage handler so the entire pipeline
// (Chat → GoogleChatService → LLM → response) is exercised end-to-end.
import { onMessage } from '../../src/server/ChatBot';

/**
* Helper that buffers the request body and parses it as UTF-8 string.
*/
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });
}

/**
* Create an `http.Server` instance that listens for `POST /message` requests
* with a JSON payload identical to the Google Chat `MESSAGE` event. The
* server calls the production `onMessage` handler and returns its JSON reply.
*
* The function **does not** call `server.listen()` – callers (typically Jest
* integration tests) are expected to bind to an ephemeral port themselves so
* they can shut down the instance after the test completes.
*/
export function createMessageServer() {
  return createNodeServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method !== 'POST' || req.url !== '/message') {
        res.writeHead(404).end();
        return;
      }

      const raw = await readBody(req);
      const event = JSON.parse(raw);

      const chatResponse = await onMessage(event);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chatResponse));
    } catch (err: any) {
      // For test purposes we surface the error message directly.
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'internal error' }));
    }
  });
}

export default createMessageServer;
