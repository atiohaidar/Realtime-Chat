import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';

export { ChatRoom } from './chat';

type Bindings = {
    CHAT_ROOM: DurableObjectNamespace;
    DB: D1Database;
    ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Serve static files from /public
app.get('/assets/*', serveStatic({ root: './' }));

// Route to serve visualization page
app.get('/flow', async (c) => {
    const url = new URL(c.req.url);
    url.pathname = '/flow.html';
    return c.env.ASSETS?.fetch(new Request(url.toString())) || c.notFound();
});

// WebSocket endpoint - proxy to Durable Object
app.get('/ws', async (c) => {
    const roomId = c.req.query('room') || 'general';
    const id = c.env.CHAT_ROOM.idFromName(roomId);
    const stub = c.env.CHAT_ROOM.get(id);

    // Forward the request to the Durable Object
    const url = new URL(c.req.url);
    url.pathname = '/websocket';

    return stub.fetch(new Request(url.toString(), c.req.raw));
});

// API to fetch message history
app.get('/api/messages', async (c) => {
    const roomId = c.req.query('room') || 'general';
    const limit = parseInt(c.req.query('limit') || '50');

    try {
        const { results } = await c.env.DB.prepare(
            'SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?'
        ).bind(roomId, limit).all();

        const response = c.json({ messages: results?.reverse() || [] });

        // Cache selama 30 detik untuk mengurangi D1 load
        response.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

        return response;
    } catch (error) {
        console.error('Error fetching messages:', error);
        return c.json({ messages: [], error: 'Database not initialized' });
    }
});

// API to delete all messages
app.delete('/api/messages', async (c) => {
    const roomId = c.req.query('room') || 'general';

    try {
        await c.env.DB.prepare('DELETE FROM messages WHERE room_id = ?').bind(roomId).run();

        // Notify DO to broadcast clear event
        const id = c.env.CHAT_ROOM.idFromName(roomId);
        const stub = c.env.CHAT_ROOM.get(id);
        await stub.fetch(new Request('http://internal/clear'));

        return c.json({ success: true });
    } catch (error) {
        console.error('Error deleting messages:', error);
        return c.json({ success: false, error: 'Failed to delete' }, 500);
    }
});


// Catch-all route to serve index.html
app.get('*', async (c) => {
    // Return the index.html for SPA routing
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    return c.env.ASSETS?.fetch(new Request(url.toString())) || c.notFound();
});

export default app;
