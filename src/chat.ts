import { DurableObject } from 'cloudflare:workers';

interface ChatMessage {
    type: 'message' | 'join' | 'leave' | 'history' | 'typing' | 'stop_typing' | 'online_users' | 'signal';
    userId: string;
    username: string;
    color: string;
    content: string;
    timestamp: number;
    users?: { userId: string, username: string, color: string }[];
    to?: string; // Optional target user ID for private signaling (WebRTC)
    metadata?: any;
}

interface SessionData {
    userId: string;
    username: string;
    color: string;
    lastTypingBroadcast?: number;
}

interface Env {
    DB: D1Database;
}

export class ChatRoom extends DurableObject<Env> {
    private roomId: string | null = null;
    private messageBuffer: ChatMessage[];
    private lastFlush: number;
    private alarmScheduled: boolean;
    private isFlushing: boolean;
    private readonly MAX_RETRY_ATTEMPTS = 3;
    private readonly MAX_BUFFER_SIZE = 100;
    private userMessageRates: Map<string, { count: number, resetAt: number }> = new Map();
    private readonly MAX_MESSAGES_PER_MINUTE = 30;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.messageBuffer = [];
        this.lastFlush = Date.now();
        this.alarmScheduled = false;
        this.isFlushing = false;

        // Cleanup stale connections on initialization
        this.ctx.getWebSockets().forEach((ws) => {
            if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                try { ws.close(); } catch (e) { }
            }
        });

        // Load buffer from persistent storage to survive restarts
        this.ctx.blockConcurrencyWhile(async () => {
            this.messageBuffer = (await this.ctx.storage.get<ChatMessage[]>('msg_buffer')) || [];
        });
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Initialize roomId once per instance life
        if (!this.roomId) {
            this.roomId = url.searchParams.get('room') || 'general';
        }

        if (url.pathname === '/websocket') {
            // Handle WebSocket upgrade
            const upgradeHeader = request.headers.get('Upgrade');
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return new Response('Expected WebSocket', { status: 426 });
            }

            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            // Accept the WebSocket with hibernation support
            this.ctx.acceptWebSocket(server);

            // Initialize session with temporary data
            const sessionData: SessionData = {
                userId: crypto.randomUUID(),
                username: 'Anonymous',
                color: '#3b82f6'
            };

            server.serializeAttachment(sessionData);

            return new Response(null, { status: 101, webSocket: client });
        }

        // Handle clear request from API
        if (url.pathname === '/clear') {
            this.broadcastClear();
            return new Response('OK');
        }

        return new Response('Not Found', { status: 404 });
    }

    private broadcastClear() {
        const clearMsg = JSON.stringify({ type: 'clear' });
        const sockets = this.ctx.getWebSockets();

        for (const ws of sockets) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(clearMsg);
                } catch (error) {
                    console.error('Error sending clear:', error);
                }
            }
        }
    }

    async alarm() {
        this.alarmScheduled = false;
        await this.flushToD1();
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        if (typeof message !== 'string') return;

        try {
            const data = JSON.parse(message);
            let session = ws.deserializeAttachment() as SessionData | null;

            if (!session) return;

            switch (data.type) {
                case 'identify':
                    // User sends their profile (from localStorage)
                    session = {
                        userId: data.userId || session.userId,
                        username: data.username || 'Anonymous',
                        color: data.color || '#3b82f6'
                    };
                    ws.serializeAttachment(session);

                    // Notify others that user joined (incremental)
                    this.broadcast({
                        type: 'join',
                        userId: session.userId,
                        username: session.username,
                        color: session.color,
                        content: `${session.username} joined the chat`,
                        timestamp: Date.now()
                    }, ws);

                    // Send full online list only to the new user
                    this.sendOnlineUsersToClient(ws);
                    break;

                case 'message':
                    if (!data.content?.trim()) return;

                    // Rate limiting: max 30 messages per minute
                    const now = Date.now();
                    const userRate = this.userMessageRates.get(session.userId) || { count: 0, resetAt: now + 60000 };

                    if (now > userRate.resetAt) {
                        userRate.count = 0;
                        userRate.resetAt = now + 60000;
                    }

                    userRate.count++;
                    this.userMessageRates.set(session.userId, userRate);

                    if (userRate.count > this.MAX_MESSAGES_PER_MINUTE) {
                        console.warn(`Rate limit exceeded for user ${session.userId}`);
                        return;
                    }

                    const chatMessage: ChatMessage = {
                        type: 'message',
                        userId: session.userId,
                        username: session.username,
                        color: session.color,
                        content: data.content.trim(),
                        timestamp: Date.now(),
                        metadata: data.metadata
                    };

                    // Broadcast to all clients EXCEPT sender (sender does optimistic UI)
                    this.broadcast(chatMessage, ws);

                    // Buffer message for D1 persistence with limit check
                    if (this.messageBuffer.length >= this.MAX_BUFFER_SIZE) {
                        console.warn('Buffer full, forcing flush');
                        await this.flushToD1();
                    }
                    this.messageBuffer.push(chatMessage);

                    // Persist buffer to storage immediately to survive hibernation
                    await this.ctx.storage.put('msg_buffer', this.messageBuffer);

                    // If this is the start of a new batch, schedule a flush (prevent race condition)
                    if (this.messageBuffer.length === 1 && !this.alarmScheduled) {
                        this.alarmScheduled = true;
                        await this.ctx.storage.setAlarm(Date.now() + 5000);
                    }

                    if (this.messageBuffer.length >= 10 && !this.isFlushing) {
                        await this.flushToD1();
                    }
                    break;

                case 'update_profile':
                    // User updated their profile
                    const oldUsername = session.username;
                    session = {
                        userId: session.userId,
                        username: data.username || session.username,
                        color: data.color || session.color
                    };
                    ws.serializeAttachment(session);

                    // Broadcast profile update (lebih efisien dari full list)
                    this.broadcast({
                        type: 'join',
                        userId: session.userId,
                        username: session.username,
                        color: session.color,
                        content: `${oldUsername} sekarang ${session.username}`,
                        timestamp: Date.now()
                    });
                    break;

                case 'typing':
                    // Rate limit: max 1 typing broadcast per 2 seconds per user
                    const typingNow = Date.now();
                    const lastBroadcast = session.lastTypingBroadcast || 0;

                    if (typingNow - lastBroadcast > 2000) {
                        session.lastTypingBroadcast = typingNow;
                        ws.serializeAttachment(session);

                        // Optimize: Skip typing broadcast in large rooms (100+ users)
                        const totalUsers = this.ctx.getWebSockets().length;
                        if (totalUsers < 100) {
                            // User is typing, broadcast to others
                            this.broadcast({
                                type: 'typing' as any,
                                userId: session.userId,
                                username: session.username,
                                color: session.color,
                                content: '',
                                timestamp: now
                            }, ws);
                        }
                    }
                    break;

                case 'stop_typing':
                    // User stopped typing - optimize for large rooms
                    const totalUsers = this.ctx.getWebSockets().length;
                    if (totalUsers < 100) {
                        this.broadcast({
                            type: 'stop_typing' as any,
                            userId: session.userId,
                            username: session.username,
                            color: session.color,
                            content: '',
                            timestamp: Date.now()
                        }, ws);
                    }
                    break;

                case 'signal':
                    // WebRTC signaling: forward the signal to the specific user 'to'
                    if (data.to) {
                        const targetSession = Array.from(this.ctx.getWebSockets()).find(socket => {
                            const sess = socket.deserializeAttachment() as SessionData | null;
                            return sess?.userId === data.to;
                        });

                        if (targetSession && targetSession.readyState === WebSocket.OPEN) {
                            try {
                                targetSession.send(JSON.stringify({
                                    type: 'signal',
                                    userId: session.userId,
                                    username: session.username,
                                    color: session.color,
                                    content: data.content,
                                    timestamp: Date.now()
                                }));
                                console.log(`Signal forwarded from ${session.userId} to ${data.to}`);
                            } catch (error) {
                                console.error('Error forwarding signal:', error);
                            }
                        } else {
                            console.error(`Target user ${data.to} not found or not connected`);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string) {
        const session = ws.deserializeAttachment() as SessionData | null;
        if (session) {
            // Incremental: broadcast leave dengan userId
            this.broadcast({
                type: 'leave',
                userId: session.userId,
                username: session.username,
                color: session.color,
                content: `${session.username} left the chat`,
                timestamp: Date.now()
            });
        }

        // Flush remaining messages when a user leaves
        if (this.messageBuffer.length > 0 && !this.isFlushing) {
            await this.flushToD1();
        }
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        console.error('WebSocket error:', error);
        // WebSocket will be automatically cleaned up
    }

    private broadcast(message: ChatMessage, exclude?: WebSocket) {
        const messageStr = JSON.stringify(message);
        const sockets = this.ctx.getWebSockets();

        for (const ws of sockets) {
            // Optimization: If a recipient is specified, only send it to that user
            if (message.to) {
                const targetSession = ws.deserializeAttachment() as SessionData | null;
                if (targetSession?.userId !== message.to) {
                    continue; // Not the intended recipient
                }
            }

            if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(messageStr);
                } catch (error) {
                    console.error('Error sending message:', error);
                }
            }
        }
    }

    private sendOnlineUsersToClient(clientWs: WebSocket) {
        const sockets = this.ctx.getWebSockets();
        const users = sockets
            .map(ws => ws.deserializeAttachment() as SessionData | null)
            .filter((session): session is SessionData => session !== null && !!session.userId)
            // Filter unique userIds to avoid duplicates if someone has multiple tabs
            .filter((user, index, self) =>
                index === self.findIndex((u) => u.userId === user.userId)
            )
            .map(user => ({
                userId: user.userId,
                username: user.username,
                color: user.color
            }));

        const message = JSON.stringify({
            type: 'online_users',
            users,
            timestamp: Date.now()
        });

        if (clientWs.readyState === WebSocket.OPEN) {
            try {
                clientWs.send(message);
            } catch (e) {
                console.error('Error sending online users:', e);
            }
        }
    }

    private async flushToD1(retryCount = 0) {
        if (this.messageBuffer.length === 0 || this.isFlushing) return;

        this.isFlushing = true;
        this.alarmScheduled = false;
        await this.ctx.storage.deleteAlarm();

        const messages = [...this.messageBuffer];
        this.messageBuffer = [];
        this.lastFlush = Date.now();

        // Clear persistent buffer since we are flushing
        await this.ctx.storage.delete('msg_buffer');

        try {
            // Batch insert messages
            const stmt = this.env.DB.prepare(
                'INSERT INTO messages (room_id, user_id, username, color, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            );

            const batch = messages.map((msg) =>
                stmt.bind(
                    this.roomId || 'general',
                    msg.userId,
                    msg.username,
                    msg.color,
                    msg.content,
                    new Date(msg.timestamp).toISOString()
                )
            );

            await this.env.DB.batch(batch);
            this.isFlushing = false;
        } catch (error) {
            console.error(`Error flushing (attempt ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS}):`, error);

            // Put messages back at the start
            this.messageBuffer.unshift(...messages);
            await this.ctx.storage.put('msg_buffer', this.messageBuffer);
            this.isFlushing = false;

            if (retryCount < this.MAX_RETRY_ATTEMPTS) {
                // Schedule a retry via Alarm (much safer than setTimeout in serverless)
                this.alarmScheduled = true;
                const delay = Math.pow(2, retryCount) * 1000;
                await this.ctx.storage.setAlarm(Date.now() + delay);
            } else {
                // Max retries exceeded - log critical error
                console.error('CRITICAL: Failed to persist messages after max retries. Data may be lost:', messages);
                // In production, you might want to send this to an error tracking service
            }
        }
    }
}
