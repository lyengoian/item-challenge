/**
 * Local Development Server
 *
 * A simple HTTP server for testing your handlers locally.
 * Not used in the Lambda/API Gateway deployment path.
 * Run with: pnpm dev
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { getItemHandler, createItemHandler, updateItemHandler, listItemsHandler } from './handlers/handlers.js';
import { parse as parseQueryString } from 'querystring'; // Used to parse query strings in the listItemsHandler.

const PORT = process.env.PORT || 3000;

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const { method, url } = req;

  // Parse request body
  let body = '';
  req.on('data', chunk => body += chunk);
  await new Promise(resolve => req.on('end', resolve));

  const parsedBody = body ? JSON.parse(body) : null;

  console.log(`${method} ${url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    let result;

    /**
     * Route matching for the four implemented endpoints.
     * More specific /api/items/:id paths are checked before the list route.
     */
    if (method === 'POST' && url === '/api/items') {
      result = await createItemHandler(parsedBody);
    } else if (method === 'GET' && url?.startsWith('/api/items/')) {
      const id = url.split('/').pop();
      result = await getItemHandler(id!);
    } else if (method === 'PUT' && url?.startsWith('/api/items/')) {
      const id = url.split('/').pop();
      result = await updateItemHandler( id!, parsedBody );
    } else if (method === 'GET' && url?.startsWith('/api/items')) {
      const [, queryString] = url.split('?');
      const query = queryString ? parseQueryString(queryString) : {};
      result = await listItemsHandler(query);
    } else {
      result = {
        statusCode: 404,
        body: { error: 'Route not found' },
      };
    }

    res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`\nExample endpoints:`);
  console.log(`  POST   http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
