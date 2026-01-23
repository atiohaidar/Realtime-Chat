import { Hono } from 'hono';

export { ChatRoom } from './chat';

type Bindings = {
    CHAT_ROOM: DurableObjectNamespace;
    DB: D1Database;
    ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Note: Static files are served automatically by Cloudflare Workers Assets (configured in wrangler.toml)

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

// API to fetch message history with cursor-based pagination
app.get('/api/messages', async (c) => {
    const roomId = c.req.query('room') || 'general';
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100); // Max 100
    const before = c.req.query('before'); // Timestamp for cursor-based pagination

    try {
        let query: string;
        let bindings: any[];

        if (before) {
            // Load messages older than the given timestamp
            query = `SELECT * FROM messages 
                     WHERE room_id = ? AND created_at < datetime(?, 'unixepoch', 'subsec') 
                     ORDER BY created_at DESC LIMIT ?`;
            bindings = [roomId, parseInt(before) / 1000, limit];
        } else {
            // Load latest messages
            query = 'SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?';
            bindings = [roomId, limit];
        }

        const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

        // Parse metadata JSON string back to object
        const messages = (results || []).reverse().map((msg: any) => ({
            ...msg,
            metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined
        }));

        const response = c.json({ messages });

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
