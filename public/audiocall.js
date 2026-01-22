// ==================== WebRTC Audio Call Module ====================
// File ini berisi semua logic untuk audio call (voice only) menggunakan WebRTC
console.log('📞 AudioCall module loading...');

// ==================== Audio Call State ====================
let audioLocalStream = null;
let audioPeerConnection = null;
let audioRemoteUserId = null;
let audioIceCandidatesQueue = [];
const AUDIO_MAX_ICE_QUEUE_SIZE = 50;
let isAudioCallMuted = false;
let audioCallDuration = 0;
let audioCallTimer = null;

// Incoming call state
let pendingAudioCallResolve = null;

// ==================== WebRTC Configuration ====================
const audioRtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

// ==================== DOM Elements ====================
const audioCallModal = document.getElementById('incomingAudioCallModal');
const audioCallerNameEl = document.getElementById('audioCallerName');
const acceptAudioCallBtn = document.getElementById('acceptAudioCallBtn');
const rejectAudioCallBtn = document.getElementById('rejectAudioCallBtn');

// ==================== Audio Call Functions ====================

async function startAudioCall() {
    try {
        if (!audioLocalStream) {
            audioLocalStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
            });
        }

        // Reset state
        isAudioCallMuted = false;
        resetAudioCallControls();

        document.getElementById('audioCallContainer').classList.add('active');
        document.getElementById('audioCallStatus').textContent = 'Menunggu jawaban...';
        document.getElementById('audioCallDuration').textContent = '00:00';

        // Kirim pesan ajakan audio call
        Chat.sendAudioCallInvite();

        Chat.renderSystemMessage('Memulai panggilan suara...');
    } catch (e) {
        console.error('Mic ditolak:', e);
        alert('Gagal akses mikrofon. Pastikan kamu mengizinkannya di browser!');
    }
}

async function joinAudioCall(targetUserId, username) {
    audioRemoteUserId = targetUserId;

    if (!audioLocalStream) {
        try {
            audioLocalStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
            });
        } catch (e) {
            alert('Izinkan mikrofon dulu ya!');
            return;
        }
    }

    // Reset state
    isAudioCallMuted = false;
    resetAudioCallControls();

    document.getElementById('audioCallContainer').classList.add('active');
    document.getElementById('audioCallRemoteName').textContent = username || 'Teman';
    document.getElementById('audioCallStatus').textContent = 'Menghubungi...';

    createAudioPeerConnection(targetUserId);

    const offer = await audioPeerConnection.createOffer();
    await audioPeerConnection.setLocalDescription(offer);
    console.log('📞 Created and set local audio offer');

    sendAudioSignal(targetUserId, { type: 'audio-offer', sdp: offer.sdp });
}

function createAudioPeerConnection(targetUserId) {
    if (audioPeerConnection) return;
    audioRemoteUserId = targetUserId;

    audioPeerConnection = new RTCPeerConnection(audioRtcConfig);

    audioLocalStream.getTracks().forEach(track => {
        console.log('➕ Adding local audio track:', track.kind, track.label);
        audioPeerConnection.addTrack(track, audioLocalStream);
    });

    audioPeerConnection.ontrack = (event) => {
        console.log('🎧 Menerima track dari teman:', event.track.kind);
        const stream = event.streams[0];

        if (event.track.kind === 'audio') {
            // Handle audio track
            const remoteAudio = document.getElementById('remoteAudio');
            if (stream && remoteAudio) {
                remoteAudio.srcObject = stream;
                remoteAudio.play().catch(e => {
                    console.error('Auto-play audio failed:', e);
                });
            }
        } else if (event.track.kind === 'video') {
            // Handle video track (screen share from remote)
            console.log('📺 Menerima screen share dari teman!');
            showRemoteScreenShare(stream);

            // When track ends, hide the remote screen share
            event.track.onended = () => {
                console.log('📺 Screen share dari teman berakhir');
                hideRemoteScreenShare();
            };
        }
    };

    audioPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendAudioSignal(targetUserId, { type: 'audio-candidate', candidate: event.candidate });
        }
    };

    audioPeerConnection.oniceconnectionstatechange = () => {
        console.log('🔌 Audio ICE Connection State:', audioPeerConnection.iceConnectionState);
        const statusEl = document.getElementById('audioCallStatus');

        if (audioPeerConnection.iceConnectionState === 'connected' ||
            audioPeerConnection.iceConnectionState === 'completed') {
            statusEl.textContent = 'Terhubung';
            Chat.renderSystemMessage('Panggilan suara terhubung!');
            startAudioCallTimer();
        } else if (audioPeerConnection.iceConnectionState === 'disconnected') {
            statusEl.textContent = 'Terputus...';
            Chat.renderSystemMessage('Koneksi audio terputus...');
        } else if (audioPeerConnection.iceConnectionState === 'failed') {
            statusEl.textContent = 'Gagal';
            Chat.renderSystemMessage('Panggilan gagal. Coba lagi.');
        }
    };

    audioPeerConnection.onconnectionstatechange = () => {
        console.log('📡 Audio Connection State:', audioPeerConnection.connectionState);
    };
}

function sendAudioSignal(to, content) {
    const ws = Chat.getWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('❌ Cannot send audio signal: WebSocket not open');
        return;
    }
    console.log('📤 Sending audio signal to', to, ':', content.type);
    ws.send(JSON.stringify({
        type: 'signal',
        to: to,
        content: JSON.stringify(content)
    }));
}

// ==================== Audio Call Timer ====================

function startAudioCallTimer() {
    audioCallDuration = 0;
    if (audioCallTimer) clearInterval(audioCallTimer);

    audioCallTimer = setInterval(() => {
        audioCallDuration++;
        const minutes = Math.floor(audioCallDuration / 60).toString().padStart(2, '0');
        const seconds = (audioCallDuration % 60).toString().padStart(2, '0');
        document.getElementById('audioCallDuration').textContent = `${minutes}:${seconds}`;
    }, 1000);
}

function stopAudioCallTimer() {
    if (audioCallTimer) {
        clearInterval(audioCallTimer);
        audioCallTimer = null;
    }
}

// ==================== Remote Screen Share Display ====================

function showRemoteScreenShare(stream) {
    let modal = document.getElementById('remoteScreenShareModal');

    if (!modal) {
        // Create modal if it doesn't exist
        modal = document.createElement('div');
        modal.id = 'remoteScreenShareModal';
        modal.className = 'screen-share-modal';
        modal.innerHTML = `
            <div class="screen-share-header">
                <span class="screen-share-title">📺 Layar Teman</span>
                <div class="screen-share-header-buttons">
                    <button id="remoteScreenShareFullscreenBtn" class="screen-share-header-btn" title="Fullscreen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <polyline points="9 21 3 21 3 15"></polyline>
                            <line x1="21" y1="3" x2="14" y2="10"></line>
                            <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                    </button>
                    <button id="remoteScreenShareMinimizeBtn" class="screen-share-header-btn" title="Minimize">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="screen-share-video-container">
                <video id="remoteScreenShareVideo" autoplay playsinline></video>
            </div>
        `;
        document.body.appendChild(modal);

        // Add event listeners
        document.getElementById('remoteScreenShareFullscreenBtn').onclick = toggleRemoteScreenShareFullscreen;
        document.getElementById('remoteScreenShareMinimizeBtn').onclick = toggleRemoteScreenShareMinimize;
    }

    const video = document.getElementById('remoteScreenShareVideo');
    if (video) {
        video.srcObject = stream;
    }

    modal.classList.add('active');
    modal.classList.remove('minimized');

    if (window.Chat) {
        window.Chat.renderSystemMessage('Teman membagikan layar');
    }
}

function hideRemoteScreenShare() {
    const modal = document.getElementById('remoteScreenShareModal');
    if (modal) {
        modal.classList.remove('active', 'fullscreen', 'minimized');
        const video = document.getElementById('remoteScreenShareVideo');
        if (video) {
            video.srcObject = null;
        }
    }

    if (window.Chat) {
        window.Chat.renderSystemMessage('Teman berhenti membagikan layar');
    }
}

function toggleRemoteScreenShareFullscreen() {
    const modal = document.getElementById('remoteScreenShareModal');
    if (modal) {
        modal.classList.toggle('fullscreen');
        modal.classList.remove('minimized');
    }
}

function toggleRemoteScreenShareMinimize() {
    const modal = document.getElementById('remoteScreenShareModal');
    if (modal) {
        modal.classList.toggle('minimized');
        modal.classList.remove('fullscreen');
    }
}

// ==================== Incoming Audio Call Modal ====================

let audioRingtoneInterval = null;

function playAudioRingtone() {
    const playRing = () => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.frequency.value = 600;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.3;
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15);

        setTimeout(() => {
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.frequency.value = 800;
            osc2.type = 'sine';
            gain2.gain.value = 0.3;
            osc2.start();
            osc2.stop(audioCtx.currentTime + 0.15);
        }, 180);
    };

    playRing();
    audioRingtoneInterval = setInterval(playRing, 1500);
}

function stopAudioRingtone() {
    if (audioRingtoneInterval) {
        clearInterval(audioRingtoneInterval);
        audioRingtoneInterval = null;
    }
}

function showIncomingAudioCallModal(callerName) {
    return new Promise((resolve) => {
        audioCallerNameEl.textContent = callerName;
        audioCallModal.style.display = 'flex';
        pendingAudioCallResolve = resolve;
        playAudioRingtone();
        console.log('📞 Incoming audio call modal displayed for', callerName);
    });
}

function hideIncomingAudioCallModal() {
    audioCallModal.style.display = 'none';
    pendingAudioCallResolve = null;
    stopAudioRingtone();
}

// ==================== Signal Handler ====================

async function handleAudioSignal(data) {
    const signal = JSON.parse(data.content);
    const from = data.userId;
    console.log('📥 Received audio signal from', data.username, ':', signal.type);

    if (signal.type === 'audio-offer') {
        // Check if this is a renegotiation (already in a call with this person)
        if (audioPeerConnection && audioRemoteUserId === from) {
            console.log('🔄 Renegotiation offer received (screen share update)');

            await audioPeerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'offer',
                sdp: signal.sdp
            }));

            const answer = await audioPeerConnection.createAnswer();
            await audioPeerConnection.setLocalDescription(answer);
            console.log('📞 Sending renegotiation answer');
            sendAudioSignal(from, { type: 'audio-answer', sdp: answer.sdp });
            return;
        }

        console.log('🔔 Showing incoming audio call modal for', data.username);

        const accepted = await showIncomingAudioCallModal(data.username);
        console.log('✅ User decision for audio call:', accepted ? 'ACCEPTED' : 'REJECTED');

        if (accepted) {
            console.log('📞 Accepting audio call from', data.username);

            if (!audioLocalStream) {
                try {
                    audioLocalStream = await navigator.mediaDevices.getUserMedia({
                        video: false,
                        audio: true
                    });
                } catch (e) {
                    console.error('Gagal akses mikrofon:', e);
                    alert('Gagal akses mikrofon. Pastikan sudah diizinkan!');
                    sendAudioSignal(from, { type: 'audio-reject' });
                    return;
                }
            }

            // Reset state dan UI
            isAudioCallMuted = false;
            resetAudioCallControls();

            document.getElementById('audioCallContainer').classList.add('active');
            document.getElementById('audioCallRemoteName').textContent = data.username;
            document.getElementById('audioCallStatus').textContent = 'Menghubungkan...';

            createAudioPeerConnection(from);
            await audioPeerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'offer',
                sdp: signal.sdp
            }));
            console.log('✅ Audio remote description set (offer)');

            // Process queued ICE candidates
            while (audioIceCandidatesQueue.length > 0) {
                const cand = audioIceCandidatesQueue.shift();
                try {
                    await audioPeerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    console.log('✅ Queued audio ICE candidate added');
                } catch (e) {
                    console.error('❌ Error adding queued audio ICE candidate:', e);
                }
            }

            const answer = await audioPeerConnection.createAnswer();
            await audioPeerConnection.setLocalDescription(answer);
            console.log('📞 Created and sending audio answer');
            sendAudioSignal(from, { type: 'audio-answer', sdp: answer.sdp });
        } else {
            console.log('❌ User explicitly rejected audio call from', data.username);
            sendAudioSignal(from, { type: 'audio-reject' });
        }
    } else if (signal.type === 'audio-reject') {
        console.log('❌ Audio call rejected by', data.username);
        alert(`${data.username} menolak panggilan suara`);
        endAudioCall();
    } else if (signal.type === 'audio-answer') {
        if (audioPeerConnection) {
            await audioPeerConnection.setRemoteDescription(new RTCSessionDescription({
                type: 'answer',
                sdp: signal.sdp
            }));
            console.log('✅ Audio remote description set (answer)');

            while (audioIceCandidatesQueue.length > 0) {
                const cand = audioIceCandidatesQueue.shift();
                try {
                    await audioPeerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    console.log('✅ Queued audio ICE candidate added');
                } catch (e) {
                    console.error('❌ Error adding queued audio ICE candidate:', e);
                }
            }
        }
    } else if (signal.type === 'audio-candidate') {
        if (signal.candidate) {
            if (audioPeerConnection && audioPeerConnection.remoteDescription) {
                try {
                    await audioPeerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    console.log('✅ Audio ICE candidate added directly');
                } catch (e) {
                    console.error('❌ Error adding audio ICE candidate:', e);
                }
            } else {
                console.log('⏳ Queue audio ICE candidate (no remote desc yet)');
                if (audioIceCandidatesQueue.length < AUDIO_MAX_ICE_QUEUE_SIZE) {
                    audioIceCandidatesQueue.push(signal.candidate);
                } else {
                    console.warn('⚠️ Audio ICE queue full, dropping old candidate');
                    audioIceCandidatesQueue.shift();
                    audioIceCandidatesQueue.push(signal.candidate);
                }
            }
        }
    } else if (signal.type === 'audio-end') {
        console.log('📞 Audio call ended by', data.username);
        Chat.renderSystemMessage(`${data.username} mengakhiri panggilan suara`);
        endAudioCall(false); // false = don't send end signal back
    }
}

// ==================== Audio Controls ====================

function resetAudioCallControls() {
    const muteBtn = document.getElementById('toggleAudioCallMuteBtn');

    if (muteBtn) {
        muteBtn.classList.remove('muted');
        muteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <span>Mic</span>
        `;
    }
}

function toggleAudioCallMute() {
    if (!audioLocalStream) return;

    const audioTrack = audioLocalStream.getAudioTracks()[0];
    if (audioTrack) {
        isAudioCallMuted = !isAudioCallMuted;
        audioTrack.enabled = !isAudioCallMuted;

        const btn = document.getElementById('toggleAudioCallMuteBtn');
        if (!isAudioCallMuted) {
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

function endAudioCall(sendSignal = true) {
    // Stop screen share first if active
    if (window.ScreenShare && window.ScreenShare.getIsScreenSharing()) {
        window.ScreenShare.stopScreenShare();
    }

    // Hide remote screen share if any
    hideRemoteScreenShare();

    // Send end signal to remote peer
    if (sendSignal && audioRemoteUserId) {
        sendAudioSignal(audioRemoteUserId, { type: 'audio-end' });
    }

    if (audioPeerConnection) {
        audioPeerConnection.close();
        audioPeerConnection = null;
    }
    if (audioLocalStream) {
        audioLocalStream.getTracks().forEach(track => track.stop());
        audioLocalStream = null;
    }

    audioRemoteUserId = null;
    audioIceCandidatesQueue = [];
    isAudioCallMuted = false;

    stopAudioCallTimer();
    resetAudioCallControls();

    document.getElementById('audioCallContainer').classList.remove('active');
    document.getElementById('remoteAudio').srcObject = null;
    document.getElementById('audioCallDuration').textContent = '00:00';
    document.getElementById('audioCallStatus').textContent = '';
}

// ==================== Getters for ScreenShare module ====================

function getPeerConnection() {
    return audioPeerConnection;
}

function getLocalStream() {
    return audioLocalStream;
}

function getIsAudioEnabled() {
    return !isAudioCallMuted;
}

function toggleMute() {
    toggleAudioCallMute();
}

// ==================== Event Listeners ====================

// Safely attach event listeners
const audioBtnEl = document.getElementById('audioBtn');
const audioHangupBtnEl = document.getElementById('audioHangupBtn');
const toggleAudioCallMuteBtnEl = document.getElementById('toggleAudioCallMuteBtn');

console.log('📞 AudioCall elements:', {
    audioBtn: !!audioBtnEl,
    audioHangupBtn: !!audioHangupBtnEl,
    toggleAudioCallMuteBtn: !!toggleAudioCallMuteBtnEl
});

if (audioBtnEl) {
    audioBtnEl.addEventListener('click', startAudioCall);
    console.log('✅ audioBtn listener attached');
} else {
    console.error('❌ audioBtn NOT FOUND!');
}
if (audioHangupBtnEl) audioHangupBtnEl.addEventListener('click', () => endAudioCall(true));
if (toggleAudioCallMuteBtnEl) toggleAudioCallMuteBtnEl.addEventListener('click', toggleAudioCallMute);

// Screen share button for audio call
const audioShareBtn = document.getElementById('audioShareScreenBtn');
if (audioShareBtn) {
    audioShareBtn.addEventListener('click', () => {
        if (window.ScreenShare) {
            window.ScreenShare.toggleScreenShare('audio');
        }
    });
}

if (acceptAudioCallBtn) {
    acceptAudioCallBtn.addEventListener('click', () => {
        console.log('✅ User clicked ACCEPT audio call');
        if (pendingAudioCallResolve) {
            pendingAudioCallResolve(true);
            hideIncomingAudioCallModal();
        }
    });
}

if (rejectAudioCallBtn) {
    rejectAudioCallBtn.addEventListener('click', () => {
        console.log('❌ User clicked REJECT audio call');
        if (pendingAudioCallResolve) {
            pendingAudioCallResolve(false);
            hideIncomingAudioCallModal();
        }
    });
}

// ==================== Export untuk digunakan oleh Chat & ScreenShare ====================

window.AudioCall = {
    handleAudioSignal,
    joinAudioCall,
    startAudioCall,
    endAudioCall,
    toggleMute,
    getPeerConnection,
    getLocalStream,
    isAudioEnabled: getIsAudioEnabled,
    getRemoteUserId: () => audioRemoteUserId
};
