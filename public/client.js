// ==================== State Management ====================
const STORAGE_KEY = 'notebook-chat-profile';

let profile = {
    userId: crypto.randomUUID(),
    username: 'Murid Baru',
    color: '#1a1a7a'
};

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

// Dynamic Room Support
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || 'general';

let typingUsers = new Set();
let typingTimeout = null;
let isTyping = false;
let lastTypingBroadcast = 0;
const TYPING_THROTTLE_MS = 2000;

// Unread & Notification State
let unreadCount = 0;
let isWindowFocused = true;
let originalTitle = document.title;

// ==================== Sound Notification ====================
// Reuse single AudioContext for better performance
let audioCtx = null;

function getAudioContext() {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function createBeepSound(frequency = 800, duration = 150, volume = 0.3) {
    try {
        const ctx = getAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(volume, ctx.currentTime);
        // Fade out to prevent click noise
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
        console.warn('Audio playback failed:', e);
    }
}

function playMessageSound() {
    if (!isWindowFocused) {
        createBeepSound(600, 100, 0.2);
        setTimeout(() => createBeepSound(800, 100, 0.2), 120);
    }
}

function playCallSound() {
    // Ringtone pattern: beep-beep, pause, beep-beep
    const playRing = () => {
        createBeepSound(700, 200, 0.4);
        setTimeout(() => createBeepSound(900, 200, 0.4), 250);
    };

    playRing();
    setTimeout(playRing, 600);
    setTimeout(playRing, 1200);
}

function playJoinSound() {
    createBeepSound(500, 80, 0.15);
    setTimeout(() => createBeepSound(700, 80, 0.15), 100);
}

function playLeaveSound() {
    createBeepSound(700, 80, 0.15);
    setTimeout(() => createBeepSound(500, 80, 0.15), 100);
}

// ==================== Unread Indicator ====================
function updateUnreadIndicator() {
    if (unreadCount > 0) {
        document.title = `(${unreadCount}) ${originalTitle}`;
    } else {
        document.title = originalTitle;
    }
}

function incrementUnread() {
    if (!isWindowFocused) {
        unreadCount++;
        updateUnreadIndicator();
    }
}

function clearUnread() {
    unreadCount = 0;
    updateUnreadIndicator();
}

// Window focus handlers
window.addEventListener('focus', () => {
    isWindowFocused = true;
    clearUnread();
});

window.addEventListener('blur', () => {
    isWindowFocused = false;
});

// ==================== DOM Elements ====================
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');
const usernameInput = document.getElementById('usernameInput');
const colorPicker = document.getElementById('colorPicker');
const colorBlobs = document.querySelectorAll('.paint-blob');
const statusBadge = document.getElementById('statusBadge');
const clearBtn = document.getElementById('clearBtn');
const onlineCountBtn = document.getElementById('onlineCountBtn');
const onlineListPopover = document.getElementById('onlineListPopover');
const onlineUserList = document.getElementById('onlineUserList');
const onlineCountText = document.getElementById('onlineCountText');

// ==================== Profile Management ====================
function loadProfile() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            profile = { ...profile, ...JSON.parse(saved) };
        } catch (e) {
            console.error('Failed to load profile:', e);
        }
    }
    updateColorSelection(profile.color);
}

function saveProfile() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function updateColorSelection(color) {
    colorPicker.value = color;
    colorBlobs.forEach(blob => {
        blob.classList.toggle('active', blob.dataset.color === color);
    });
}

// ==================== WebSocket Connection ====================
function connect() {
    updateStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?room=${roomId}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Notebook connected');
        updateStatus('connected');
        reconnectAttempts = 0;
        sendBtn.disabled = false;

        // Send identification
        ws.send(JSON.stringify({
            type: 'identify',
            userId: profile.userId,
            username: profile.username,
            color: profile.color
        }));

        // Load message history
        loadHistory();
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    };

    ws.onclose = () => {
        updateStatus('disconnected');
        sendBtn.disabled = true;
        attemptReconnect();
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('error');
    };
}

function attemptReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        setTimeout(connect, RECONNECT_DELAY);
    } else {
        updateStatus('failed');
    }
}

function updateStatus(status) {
    statusBadge.className = 'status-badge';
    switch (status) {
        case 'connected':
            statusBadge.classList.add('connected');
            statusBadge.textContent = 'Terhubung';
            break;
        case 'connecting':
            statusBadge.textContent = 'Menghubungkan...';
            break;
        case 'disconnected':
            statusBadge.style.color = '#888';
            statusBadge.style.borderColor = '#888';
            statusBadge.textContent = 'Terputus';
            break;
        case 'error':
            statusBadge.style.color = '#c92a2a';
            statusBadge.style.borderColor = '#c92a2a';
            statusBadge.textContent = 'Error';
            break;
        case 'failed':
            statusBadge.style.color = '#c92a2a';
            statusBadge.textContent = 'Gagal Koneksi';
            break;
    }
}

// ==================== Message History ====================
let oldestMessageTimestamp = null;
let isLoadingHistory = false;
let hasMoreHistory = true;
const HISTORY_PAGE_SIZE = 30;

async function loadHistory(loadOlder = false) {
    if (isLoadingHistory || (!hasMoreHistory && loadOlder)) return;
    isLoadingHistory = true;

    try {
        // Build query URL
        let url = `/api/messages?room=${roomId}&limit=${HISTORY_PAGE_SIZE}`;
        if (loadOlder && oldestMessageTimestamp) {
            url += `&before=${oldestMessageTimestamp}`;
        }

        // Clear initial placeholder if exists (only on first load)
        if (!loadOlder && messagesContainer.querySelector('.system-message')) {
            messagesContainer.innerHTML = '';
        }

        // Show loading indicator when loading older messages
        let loadingIndicator = null;
        if (loadOlder) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading-history';
            loadingIndicator.textContent = 'Memuat pesan lama...';
            loadingIndicator.style.cssText = 'text-align:center;padding:0.5rem;color:#888;font-style:italic;';
            messagesContainer.prepend(loadingIndicator);
        }

        const response = await fetch(url);
        const data = await response.json();

        // Remove loading indicator
        if (loadingIndicator) loadingIndicator.remove();

        if (data.messages && data.messages.length > 0) {
            // Track if we have more history
            if (data.messages.length < HISTORY_PAGE_SIZE) {
                hasMoreHistory = false;
            }

            // Get scroll position before adding messages
            const prevScrollHeight = messagesContainer.scrollHeight;

            if (!loadOlder) {
                messagesContainer.innerHTML = ''; // Clear on first load
            }

            // Render messages
            const fragment = document.createDocumentFragment();
            data.messages.forEach((msg, index) => {
                const msgEl = createMessageElement({
                    type: 'message',
                    userId: msg.user_id,
                    username: msg.username,
                    color: msg.color,
                    content: msg.content,
                    timestamp: new Date(msg.created_at).getTime(),
                    metadata: msg.metadata
                });

                if (loadOlder) {
                    fragment.appendChild(msgEl);
                } else {
                    messagesContainer.appendChild(msgEl);
                }

                // Track oldest message
                if (index === 0 || new Date(msg.created_at).getTime() < oldestMessageTimestamp) {
                    oldestMessageTimestamp = new Date(msg.created_at).getTime();
                }
            });

            if (loadOlder) {
                // Prepend older messages
                messagesContainer.prepend(fragment);
                // Maintain scroll position
                messagesContainer.scrollTop = messagesContainer.scrollHeight - prevScrollHeight;
            } else {
                scrollToBottom();
            }
        } else if (!loadOlder) {
            renderSystemMessage('Halaman masih kosong...');
        } else {
            hasMoreHistory = false;
        }
    } catch (e) {
        console.error('Failed to load history:', e);
    } finally {
        isLoadingHistory = false;
    }
}

// Lazy load older messages on scroll to top
messagesContainer.addEventListener('scroll', () => {
    if (messagesContainer.scrollTop <= 50 && hasMoreHistory && !isLoadingHistory) {
        loadHistory(true);
    }
});

// Helper function to create message element without appending
function createMessageElement(data) {
    const isOwn = data.userId === profile.userId;
    const time = new Date(data.timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
    const initial = data.username.charAt(0).toUpperCase();
    const inkColor = data.color || (isOwn ? profile.color : '#333');

    const messageEl = document.createElement('div');
    messageEl.className = `message-row ${isOwn ? 'own' : ''}`;

    messageEl.innerHTML = `
        <div class="avatar-doodle" style="background-color: ${inkColor}">${initial}</div>
        <div class="message-bubble ${data.metadata?.action === 'join_call' ? 'call-invite' : ''} ${data.metadata?.action === 'join_audio_call' ? 'audio-call-invite' : ''}" 
             style="${(data.metadata?.action === 'join_call' || data.metadata?.action === 'join_audio_call') ? 'cursor: pointer;' : ''}">
            ${!isOwn ? `<span class="sender-name" style="color:${inkColor}">${escapeHtml(data.username)}</span>` : ''}
            <div class="message-text" style="color: ${inkColor}">
                ${escapeHtml(data.content)}
                <span class="timestamp">${time}</span>
            </div>
        </div>
    `;

    // Add click handlers for call invites
    if (data.metadata?.action === 'join_call' && !isOwn) {
        messageEl.querySelector('.message-bubble').addEventListener('click', () => {
            if (window.VideoCall) {
                window.VideoCall.joinVideoCall(data.userId, data.username);
            }
        });
    }

    if (data.metadata?.action === 'join_audio_call' && !isOwn) {
        messageEl.querySelector('.message-bubble').addEventListener('click', () => {
            if (window.AudioCall) {
                window.AudioCall.joinAudioCall(data.userId, data.username);
            }
        });
    }

    return messageEl;
}

// ==================== Message Handling ====================
function handleMessage(data) {
    // Remove placeholder if it exists and we get a real message
    const placeholder = messagesContainer.querySelector('.system-message');
    if (placeholder && data.type === 'message') {
        placeholder.remove();
    }

    switch (data.type) {
        case 'message':
            renderMessage(data);
            // Play sound and update unread for messages from others
            if (data.userId !== profile.userId) {
                playMessageSound();
                incrementUnread();
            }
            break;
        case 'typing':
            if (data.userId !== profile.userId) {
                typingUsers.add(data.username);
                updateTypingIndicator();
            }
            break;
        case 'stop_typing':
            if (data.userId !== profile.userId) {
                typingUsers.delete(data.username);
                updateTypingIndicator();
            }
            break;
        case 'join':
            if (data.userId !== profile.userId) {
                renderSystemMessage(`👋 ${data.username} bergabung ke chat`);
                playJoinSound();
            }
            break;
        case 'leave':
            if (data.userId !== profile.userId) {
                renderSystemMessage(`👋 ${data.username} meninggalkan chat`);
                playLeaveSound();
            }
            break;
        case 'online_users':
            updateOnlineList(data.users);
            break;
        case 'clear':
            messagesContainer.innerHTML = '';
            renderSystemMessage('Halaman telah dihapus bersih oleh seseorang');
            break;
        case 'signal':
            // Parse signal to determine type
            try {
                const signalContent = JSON.parse(data.content);
                if (signalContent.type && signalContent.type.startsWith('audio-')) {
                    // Delegasi ke AudioCall module
                    if (window.AudioCall) {
                        window.AudioCall.handleAudioSignal(data);
                    }
                } else if (signalContent.type === 'screen-share-status' && signalContent.mode === 'audio') {
                    // Screen share status for audio call
                    if (window.AudioCall) {
                        window.AudioCall.handleAudioSignal(data);
                    }
                } else {
                    // Delegasi ke VideoCall module
                    if (window.VideoCall) {
                        window.VideoCall.handleVideoSignal(data);
                    }
                }
            } catch (e) {
                // Fallback ke VideoCall jika parsing error
                if (window.VideoCall) {
                    window.VideoCall.handleVideoSignal(data);
                }
            }
            break;
    }
}

function updateOnlineList(users) {
    onlineCountText.textContent = `${users.length} Online`;
    onlineUserList.innerHTML = '';

    users.forEach(user => {
        const userEl = document.createElement('div');
        userEl.className = 'online-user-item';
        userEl.innerHTML = `
            <div class="online-dot" style="background: ${user.color || '#15803d'}"></div>
            <span class="online-user-name" style="color: ${user.color || 'inherit'}">${escapeHtml(user.username)} ${user.userId === profile.userId ? '(Kamu)' : ''}</span>
        `;
        onlineUserList.appendChild(userEl);
    });
}

// Toggle online list popover
onlineCountBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onlineListPopover.classList.toggle('active');
});

document.addEventListener('click', () => {
    onlineListPopover.classList.remove('active');
});

onlineListPopover.addEventListener('click', (e) => {
    e.stopPropagation();
});

function renderMessage(data, shouldScroll = true) {
    const messageEl = createMessageElement(data);

    // Insert before typing indicator if exists
    const typingInd = document.getElementById('typingIndicator');
    if (typingInd) {
        messagesContainer.insertBefore(messageEl, typingInd);
    } else {
        messagesContainer.appendChild(messageEl);
    }
    if (shouldScroll) scrollToBottom();
}

function renderSystemMessage(content) {
    const messageEl = document.createElement('div');
    messageEl.className = 'system-message-row';
    messageEl.style.textAlign = 'center';
    messageEl.style.color = '#888';
    messageEl.style.margin = '1rem 0';
    messageEl.style.fontStyle = 'italic';
    messageEl.innerHTML = `<span>${escapeHtml(content)}</span>`;

    // Insert before typing indicator if exists
    const typingInd = document.getElementById('typingIndicator');
    if (typingInd) {
        messagesContainer.insertBefore(messageEl, typingInd);
    } else {
        messagesContainer.appendChild(messageEl);
    }
    scrollToBottom();
}

function updateTypingIndicator() {
    let ind = document.getElementById('typingIndicator');
    if (typingUsers.size > 0) {
        if (!ind) {
            ind = document.createElement('div');
            ind.id = 'typingIndicator';
            ind.className = 'typing-indicator';
            ind.style.fontSize = '0.9rem';
            ind.style.color = '#888';
            ind.style.fontStyle = 'italic';
            ind.style.padding = '0.5rem 0';
            messagesContainer.appendChild(ind);
        }
        const users = Array.from(typingUsers);
        ind.textContent = users.length > 1
            ? `${users[0]} dan ${users.length - 1} lainnya sedang menulis...`
            : `${users[0]} sedang menulis...`;
        scrollToBottom();
    } else if (ind) {
        ind.remove();
    }
}

function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: 'message',
        content: content
    }));

    // Optimistic UI update
    renderMessage({
        type: 'message',
        userId: profile.userId,
        username: profile.username,
        color: profile.color,
        content: content,
        timestamp: Date.now()
    });

    if (isTyping) {
        isTyping = false;
        ws.send(JSON.stringify({ type: 'stop_typing' }));
    }
    messageInput.value = '';
}

// ==================== Utilities ====================
let scrollPending = false;
function scrollToBottom() {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        scrollPending = false;
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== Event Listeners ====================
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', () => {
    const now = Date.now();

    // Throttle: hanya kirim typing indicator max 1x per 2 detik
    if (!isTyping && ws && ws.readyState === WebSocket.OPEN && (now - lastTypingBroadcast) > TYPING_THROTTLE_MS) {
        isTyping = true;
        lastTypingBroadcast = now;
        ws.send(JSON.stringify({ type: 'typing' }));
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        if (isTyping && ws && ws.readyState === WebSocket.OPEN) {
            isTyping = false;
            ws.send(JSON.stringify({ type: 'stop_typing' }));
        }
    }, 3000);
});

settingsBtn.addEventListener('click', () => {
    usernameInput.value = profile.username;
    updateColorSelection(profile.color);
    settingsModal.classList.add('active');
});

[cancelBtn, settingsModal].forEach(el => {
    el.addEventListener('click', (e) => {
        if (e.target === el) settingsModal.classList.remove('active');
    });
});

colorBlobs.forEach(blob => {
    blob.addEventListener('click', () => {
        const color = blob.dataset.color;
        updateColorSelection(color);
    });
});

saveBtn.addEventListener('click', () => {
    const newUsername = usernameInput.value.trim() || 'Murid';
    const newColor = colorPicker.value;

    profile.username = newUsername;
    profile.color = newColor;
    saveProfile();

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_profile',
            username: profile.username,
            color: profile.color
        }));
    }

    settingsModal.classList.remove('active');
});

clearBtn.addEventListener('click', async () => {
    if (confirm('Robek halaman ini (hapus semua chat)?')) {
        try {
            await fetch(`/api/messages?room=${roomId}`, { method: 'DELETE' });
        } catch (e) {
            console.error('Failed to clear:', e);
        }
    }
});

// ==================== Export Chat Module ====================
window.Chat = {
    getWebSocket: () => ws,
    getProfile: () => profile,
    renderSystemMessage,
    escapeHtml,
    sendVideoCallInvite: () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'message',
                content: '📞 [KLIK DI SINI] ',
                metadata: { action: 'join_call' }
            }));
        }
    },
    sendAudioCallInvite: () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'message',
                content: '📞 [KLIK UNTUK TELEPON] ',
                metadata: { action: 'join_audio_call' }
            }));
        }
    }
};

// ==================== Initialization ====================
loadProfile();
connect();
