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

// Incoming call state
let pendingCallData = null;
let pendingCallResolve = null;

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
const incomingCallModal = document.getElementById('incomingCallModal');
const callerNameEl = document.getElementById('callerName');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');

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
async function loadHistory() {
    try {
        // Clear initial placeholder if exists
        if (messagesContainer.querySelector('.system-message')) {
            messagesContainer.innerHTML = '';
        }

        const response = await fetch(`/api/messages?room=${roomId}&limit=50`);
        const data = await response.json();

        if (data.messages && data.messages.length > 0) {
            messagesContainer.innerHTML = ''; // Clear carefully
            data.messages.forEach(msg => {
                renderMessage({
                    type: 'message',
                    userId: msg.user_id,
                    username: msg.username,
                    color: msg.color,
                    content: msg.content,
                    timestamp: new Date(msg.created_at).getTime()
                }, false);
            });
            scrollToBottom();
        } else {
            renderSystemMessage('Halaman masih kosong...');
        }
    } catch (e) {
        console.error('Failed to load history:', e);
    }
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
        case 'leave':
            // Optional: renderSystemMessage(`${data.username} ${data.type === 'join' ? 'masuk kelas' : 'pulang'}`);
            break;
        case 'online_users':
            updateOnlineList(data.users);
            break;
        case 'clear':
            messagesContainer.innerHTML = '';
            renderSystemMessage('Halaman telah dihapus bersih oleh seseorang');
            break;
        case 'signal':
            handleVideoSignal(data);
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
    const isOwn = data.userId === profile.userId;
    const time = new Date(data.timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
    const initial = data.username.charAt(0).toUpperCase();

    const messageEl = document.createElement('div');
    messageEl.className = `message-row ${isOwn ? 'own' : ''}`;

    // For notebook style, we apply the user's selected ink color
    const inkColor = data.color || (isOwn ? profile.color : '#333');

    messageEl.innerHTML = `
        <div class="avatar-doodle" style="background-color: ${inkColor}">${initial}</div>
        <div class="message-bubble ${data.metadata?.action === 'join_call' ? 'call-invite' : ''}" 
             style="${data.metadata?.action === 'join_call' ? 'cursor: pointer;' : ''}">
            ${!isOwn ? `<span class="sender-name" style="color:${inkColor}">${escapeHtml(data.username)}</span>` : ''}
            <div class="message-text" style="color: ${inkColor}">
                ${escapeHtml(data.content)}
                <span class="timestamp">${time}</span>
            </div>
        </div>
    `;

    if (data.metadata?.action === 'join_call' && !isOwn) {
        messageEl.querySelector('.message-bubble').addEventListener('click', () => {
            joinVideoCall(data.userId, data.username);
        });
    }

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

// ==================== WebRTC Video Call Logic ====================
let localStream = null;
let peerConnection = null;
let remoteUserId = null;
let iceCandidatesQueue = [];
const MAX_ICE_QUEUE_SIZE = 50; // Prevent memory leak
let isAudioEnabled = true;
let isVideoEnabled = true;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

async function startVideoCall() {
    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('localVideo').srcObject = localStream;
        }

        // Reset state ke enabled
        isAudioEnabled = true;
        isVideoEnabled = true;
        resetVideoControls();

        document.getElementById('videoCallContainer').classList.add('active');

        // Kirim pesan ajakan ke chat
        ws.send(JSON.stringify({
            type: 'message',
            content: '📞 [KLIK DI SINI] ',
            metadata: { action: 'join_call' }
        }));

        renderSystemMessage('Menunggu orang lain bergabung...');
    } catch (e) {
        console.error('Mic/Kamera ditolak:', e);
        alert('Gagal akses kamera/mic. Pastikan kamu mengizinkannya di browser ya!');
    }
}

async function joinVideoCall(targetUserId, username) {
    remoteUserId = targetUserId;
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('localVideo').srcObject = localStream;
        } catch (e) {
            alert('Izinkan kamera dulu ya!');
            return;
        }
    }

    // Reset state ke enabled
    isAudioEnabled = true;
    isVideoEnabled = true;
    resetVideoControls();

    document.getElementById('videoCallContainer').classList.add('active');
    document.getElementById('remoteLabel').textContent = username || 'Teman';
    createPeerConnection(targetUserId);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('📞 Created and set local offer');

    sendSignal(targetUserId, { type: 'offer', sdp: offer.sdp });
}

function createPeerConnection(targetUserId) {
    if (peerConnection) return;
    remoteUserId = targetUserId;

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        console.log('➕ Adding local track:', track.kind, track.label);
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        console.log('🎥 Menerima stream dari teman!', event.streams);
        const remoteVid = document.getElementById('remoteVideo');
        const stream = event.streams[0];

        if (stream && remoteVid) {
            console.log('🎥 Stream tracks:', stream.getTracks().map(t => t.kind));
            remoteVid.srcObject = stream;

            // Pastikan video di-play
            setTimeout(() => {
                remoteVid.play().then(() => {
                    console.log('✅ Remote video playing');
                }).catch(e => {
                    console.error('❌ Auto-play failed:', e);
                    // Try again
                    remoteVid.play();
                });
            }, 100);
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(targetUserId, { type: 'candidate', candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('🔌 ICE Connection State:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
            renderSystemMessage('Terhubung dengan teman!');
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            renderSystemMessage('Koneksi terputus...');
        } else if (peerConnection.iceConnectionState === 'failed') {
            renderSystemMessage('Koneksi gagal. Coba lagi.');
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('📡 Connection State:', peerConnection.connectionState);
    };
}

function sendSignal(to, content) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('❌ Cannot send signal: WebSocket not open');
        return;
    }
    console.log('📤 Sending signal to', to, ':', content.type);
    ws.send(JSON.stringify({
        type: 'signal',
        to: to,
        content: JSON.stringify(content)
    }));
}

// Show custom incoming call modal (Promise-based)
function showIncomingCallModal(callerName) {
    return new Promise((resolve) => {
        callerNameEl.textContent = callerName;
        incomingCallModal.style.display = 'flex';
        pendingCallResolve = resolve;

        console.log('📞 Incoming call modal displayed for', callerName);
    });
}

// Hide incoming call modal
function hideIncomingCallModal() {
    incomingCallModal.style.display = 'none';
    pendingCallResolve = null;
}

async function handleVideoSignal(data) {
    const signal = JSON.parse(data.content);
    const from = data.userId;
    console.log('📥 Received signal from', data.username, ':', signal.type);

    if (signal.type === 'offer') {
        console.log('🔔 Showing incoming call modal for', data.username);

        // Show custom modal and wait for user response
        const accepted = await showIncomingCallModal(data.username);
        console.log('✅ User decision:', accepted ? 'ACCEPTED' : 'REJECTED');

        if (accepted) {
            console.log('📞 Accepting video call from', data.username);

            if (!localStream) {
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    document.getElementById('localVideo').srcObject = localStream;
                } catch (e) {
                    console.error('Gagal akses media:', e);
                    alert('Gagal akses kamera/mic. Pastikan sudah diizinkan!');
                    // Send reject signal
                    sendSignal(from, { type: 'reject' });
                    return;
                }
            }

            // Reset state dan UI
            isAudioEnabled = true;
            isVideoEnabled = true;
            resetVideoControls();

            document.getElementById('videoCallContainer').classList.add('active');
            document.getElementById('remoteLabel').textContent = data.username;

            // Pastikan remote video box tidak ada class video-off
            const remoteVideoBox = document.getElementById('remoteVideoBox');
            if (remoteVideoBox) {
                remoteVideoBox.classList.remove('video-off');
            }

            createPeerConnection(from);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
            console.log('✅ Remote description set (offer)');

            // Process queued ICE candidates
            while (iceCandidatesQueue.length > 0) {
                const cand = iceCandidatesQueue.shift();
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    console.log('✅ Queued ICE candidate added');
                } catch (e) {
                    console.error('❌ Error adding queued ICE candidate:', e);
                }
            }

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            console.log('📞 Created and sending answer');
            sendSignal(from, { type: 'answer', sdp: answer.sdp });
        } else {
            // User explicitly clicked Reject
            console.log('❌ User explicitly rejected call from', data.username);
            sendSignal(from, { type: 'reject' });
        }
    } else if (signal.type === 'reject') {
        // Call was rejected
        console.log('❌ Call rejected by', data.username);
        alert(`${data.username} menolak video call`);
        endCall();
    } else if (signal.type === 'answer') {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
            console.log('✅ Remote description set (answer)');

            // Process queued ICE candidates
            while (iceCandidatesQueue.length > 0) {
                const cand = iceCandidatesQueue.shift();
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    console.log('✅ Queued ICE candidate added');
                } catch (e) {
                    console.error('❌ Error adding queued ICE candidate:', e);
                }
            }
        }
    } else if (signal.type === 'candidate') {
        if (signal.candidate) {
            if (peerConnection && peerConnection.remoteDescription) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    console.log('✅ ICE candidate added directly');
                } catch (e) {
                    console.error('❌ Error adding ICE candidate:', e);
                }
            } else {
                console.log('⏳ Queue ICE candidate (no remote desc yet)');
                if (iceCandidatesQueue.length < MAX_ICE_QUEUE_SIZE) {
                    iceCandidatesQueue.push(signal.candidate);
                } else {
                    console.warn('⚠️ ICE queue full, dropping old candidate');
                    iceCandidatesQueue.shift();
                    iceCandidatesQueue.push(signal.candidate);
                }
            }
        }
    }
}

function resetVideoControls() {
    const audioBtn = document.getElementById('toggleAudioBtn');
    const videoBtn = document.getElementById('toggleVideoBtn');
    const localVideoBox = document.getElementById('localVideoBox');

    // Reset audio button
    if (audioBtn) {
        audioBtn.classList.remove('muted');
        audioBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <span>Mic</span>
        `;
    }

    // Reset video button
    if (videoBtn) {
        videoBtn.classList.remove('muted');
        localVideoBox.classList.remove('video-off');
        videoBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            <span>Kamera</span>
        `;
    }
}

function toggleAudio() {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isAudioEnabled = !isAudioEnabled;
        audioTrack.enabled = isAudioEnabled;

        const btn = document.getElementById('toggleAudioBtn');
        if (isAudioEnabled) {
            btn.classList.remove('muted');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
                <span>Mic</span>
            `;
        } else {
            btn.classList.add('muted');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
                <span>Muted</span>
            `;
        }
    }
}

function toggleVideo() {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        isVideoEnabled = !isVideoEnabled;
        videoTrack.enabled = isVideoEnabled;

        const btn = document.getElementById('toggleVideoBtn');
        const localVideoBox = document.getElementById('localVideoBox');

        if (isVideoEnabled) {
            btn.classList.remove('muted');
            localVideoBox.classList.remove('video-off');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
                <span>Kamera</span>
            `;
        } else {
            btn.classList.add('muted');
            localVideoBox.classList.add('video-off');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                </svg>
                <span>Kamera Off</span>
            `;
        }
    }
}

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    remoteUserId = null;
    iceCandidatesQueue = [];
    isAudioEnabled = true;
    isVideoEnabled = true;

    // Reset UI controls
    resetVideoControls();

    document.getElementById('videoCallContainer').classList.remove('active');
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
}

document.getElementById('videoBtn').addEventListener('click', startVideoCall);
document.getElementById('hangupBtn').addEventListener('click', endCall);
document.getElementById('toggleAudioBtn').addEventListener('click', toggleAudio);
document.getElementById('toggleVideoBtn').addEventListener('click', toggleVideo);

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

// Incoming call modal handlers
acceptCallBtn.addEventListener('click', () => {
    console.log('✅ User clicked ACCEPT');
    if (pendingCallResolve) {
        pendingCallResolve(true);
        hideIncomingCallModal();
    }
});

rejectCallBtn.addEventListener('click', () => {
    console.log('❌ User clicked REJECT');
    if (pendingCallResolve) {
        pendingCallResolve(false);
        hideIncomingCallModal();
    }
});

// ==================== Initialization ====================
loadProfile();
connect();
