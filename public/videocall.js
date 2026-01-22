// ==================== WebRTC Video Call Module ====================
// File ini berisi semua logic untuk video call menggunakan WebRTC
console.log('📹 VideoCall module loading...');

// ==================== Video Call State ====================
let localStream = null;
let peerConnection = null;
let remoteUserId = null;
let iceCandidatesQueue = [];
const MAX_ICE_QUEUE_SIZE = 50;
let isAudioEnabled = true;
let isVideoEnabled = true;
let isRemoteVideoFullscreen = false;

// Incoming call state
let pendingCallResolve = null;

// ==================== WebRTC Configuration ====================
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

// ==================== DOM Elements ====================
const incomingCallModal = document.getElementById('incomingCallModal');
const callerNameEl = document.getElementById('callerName');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');

// ==================== Video Call Functions ====================

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

        // Kirim pesan ajakan ke chat (menggunakan global Chat object)
        window.Chat.sendVideoCallInvite();

        window.Chat.renderSystemMessage('Menunggu orang lain bergabung...');
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
            window.Chat.renderSystemMessage('Terhubung dengan teman!');
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            window.Chat.renderSystemMessage('Koneksi terputus...');
        } else if (peerConnection.iceConnectionState === 'failed') {
            window.Chat.renderSystemMessage('Koneksi gagal. Coba lagi.');
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('📡 Connection State:', peerConnection.connectionState);
    };
}

function sendSignal(to, content) {
    const ws = window.Chat.getWebSocket();
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

// ==================== Incoming Call Modal ====================

let ringtoneInterval = null;

function playRingtone() {
    const playRing = () => {
        if (typeof createBeepSound === 'undefined') {
            // Fallback if createBeepSound not available
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.frequency.value = 700;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.15);
            
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.frequency.value = 900;
                osc2.type = 'sine';
                gain2.gain.value = 0.3;
                osc2.start();
                osc2.stop(audioCtx.currentTime + 0.15);
            }, 180);
        }
    };
    
    playRing();
    ringtoneInterval = setInterval(playRing, 1500);
}

function stopRingtone() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
}

function showIncomingCallModal(callerName) {
    return new Promise((resolve) => {
        callerNameEl.textContent = callerName;
        incomingCallModal.style.display = 'flex';
        pendingCallResolve = resolve;
        playRingtone();
        console.log('📞 Incoming call modal displayed for', callerName);
    });
}

function hideIncomingCallModal() {
    incomingCallModal.style.display = 'none';
    pendingCallResolve = null;
    stopRingtone();
}

// ==================== Signal Handler ====================

async function handleVideoSignal(data) {
    const signal = JSON.parse(data.content);
    const from = data.userId;
    console.log('📥 Received signal from', data.username, ':', signal.type);

    if (signal.type === 'offer') {
        console.log('🔔 Showing incoming call modal for', data.username);

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
            console.log('❌ User explicitly rejected call from', data.username);
            sendSignal(from, { type: 'reject' });
        }
    } else if (signal.type === 'reject') {
        console.log('❌ Call rejected by', data.username);
        alert(`${data.username} menolak video call`);
        endCall();
    } else if (signal.type === 'answer') {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
            console.log('✅ Remote description set (answer)');

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
    } else if (signal.type === 'screen-share-status') {
        // Handle screen share signal from remote
        if (window.ScreenShare && window.ScreenShare.handleScreenShareSignal) {
            window.ScreenShare.handleScreenShareSignal(signal);
        }
    } else if (signal.type === 'video-end') {
        // Remote peer ended the call
        console.log('📞 Remote peer ended video call');
        window.Chat.renderSystemMessage(`${data.username} mengakhiri panggilan`);
        endCall(false); // false = don't send end signal back
    }
}

// ==================== Video Controls ====================

function resetVideoControls() {
    const audioBtn = document.getElementById('toggleAudioBtn');
    const videoBtn = document.getElementById('toggleVideoBtn');
    const localVideoBox = document.getElementById('localVideoBox');

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

function endCall(sendSignalToRemote = true) {
    // Stop screen share first if active
    if (window.ScreenShare && window.ScreenShare.getIsScreenSharing()) {
        window.ScreenShare.stopScreenShare();
    }
    
    // Close remote video fullscreen if open
    hideRemoteVideoFullscreen();
    
    // Send end signal to remote peer
    if (sendSignalToRemote && remoteUserId) {
        sendSignal(remoteUserId, { type: 'video-end' });
    }

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

    resetVideoControls();

    document.getElementById('videoCallContainer').classList.remove('active');
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
}

// ==================== Getters for ScreenShare module ====================

function getPeerConnection() {
    return peerConnection;
}

function getLocalStream() {
    return localStream;
}

function getIsAudioEnabled() {
    return isAudioEnabled;
}

function getIsVideoEnabled() {
    return isVideoEnabled;
}

// ==================== Event Listeners ====================

// Safely attach event listeners
const videoBtnEl = document.getElementById('videoBtn');
const hangupBtnEl = document.getElementById('hangupBtn');
const toggleAudioBtnEl = document.getElementById('toggleAudioBtn');
const toggleVideoBtnEl = document.getElementById('toggleVideoBtn');
const shareScreenBtnEl = document.getElementById('shareScreenBtn');

console.log('📹 VideoCall elements:', { 
    videoBtn: !!videoBtnEl, 
    hangupBtn: !!hangupBtnEl,
    toggleAudioBtn: !!toggleAudioBtnEl,
    toggleVideoBtn: !!toggleVideoBtnEl,
    shareScreenBtn: !!shareScreenBtnEl
});

if (videoBtnEl) {
    videoBtnEl.addEventListener('click', startVideoCall);
    console.log('✅ videoBtn listener attached');
} else {
    console.error('❌ videoBtn NOT FOUND!');
}
if (hangupBtnEl) hangupBtnEl.addEventListener('click', endCall);
if (toggleAudioBtnEl) toggleAudioBtnEl.addEventListener('click', toggleAudio);
if (toggleVideoBtnEl) toggleVideoBtnEl.addEventListener('click', toggleVideo);
if (shareScreenBtnEl) shareScreenBtnEl.addEventListener('click', () => {
    if (window.ScreenShare) {
        window.ScreenShare.toggleScreenShare('video');
    }
});

// ==================== Remote Video Fullscreen ====================

const remoteFullscreenBtnEl = document.getElementById('remoteFullscreenBtn');
const rvfMinimizeBtnEl = document.getElementById('rvfMinimizeBtn');
const rvfToggleFullscreenBtnEl = document.getElementById('rvfToggleFullscreenBtn');
const rvfToggleAudioBtnEl = document.getElementById('rvfToggleAudioBtn');
const rvfToggleVideoBtnEl = document.getElementById('rvfToggleVideoBtn');
const rvfShareScreenBtnEl = document.getElementById('rvfShareScreenBtn');
const rvfHangupBtnEl = document.getElementById('rvfHangupBtn');

if (remoteFullscreenBtnEl) remoteFullscreenBtnEl.addEventListener('click', showRemoteVideoFullscreen);
if (rvfMinimizeBtnEl) rvfMinimizeBtnEl.addEventListener('click', hideRemoteVideoFullscreen);
if (rvfToggleFullscreenBtnEl) rvfToggleFullscreenBtnEl.addEventListener('click', toggleRemoteVideoModalFullscreen);
if (rvfToggleAudioBtnEl) rvfToggleAudioBtnEl.addEventListener('click', () => {
    toggleAudio();
    updateRemoteVideoFullscreenControls();
});
if (rvfToggleVideoBtnEl) rvfToggleVideoBtnEl.addEventListener('click', () => {
    toggleVideo();
    updateRemoteVideoFullscreenControls();
});
if (rvfShareScreenBtnEl) rvfShareScreenBtnEl.addEventListener('click', () => {
    if (window.ScreenShare) {
        window.ScreenShare.toggleScreenShare('video');
    }
});
if (rvfHangupBtnEl) rvfHangupBtnEl.addEventListener('click', () => {
    hideRemoteVideoFullscreen();
    endCall();
});

function showRemoteVideoFullscreen() {
    const modal = document.getElementById('remoteVideoFullscreenModal');
    const remoteVideo = document.getElementById('remoteVideo');
    const remoteVideoFS = document.getElementById('remoteVideoFullscreen');
    const localVideoFS = document.getElementById('rvfLocalVideo');
    const remoteLabelFS = document.getElementById('remoteVideoFullscreenLabel');
    const remoteLabel = document.getElementById('remoteLabel');
    
    // Share the same stream with fullscreen video
    if (remoteVideo.srcObject) {
        remoteVideoFS.srcObject = remoteVideo.srcObject;
    }
    if (localStream) {
        localVideoFS.srcObject = localStream;
    }
    
    remoteLabelFS.textContent = remoteLabel.textContent + ' - Video Call';
    
    modal.classList.add('active');
    modal.classList.remove('minimized');
    isRemoteVideoFullscreen = true;
    
    updateRemoteVideoFullscreenControls();
}

function hideRemoteVideoFullscreen() {
    const modal = document.getElementById('remoteVideoFullscreenModal');
    modal.classList.remove('active', 'fullscreen', 'minimized');
    isRemoteVideoFullscreen = false;
}

function toggleRemoteVideoModalFullscreen() {
    const modal = document.getElementById('remoteVideoFullscreenModal');
    modal.classList.toggle('fullscreen');
    modal.classList.remove('minimized');
}

function updateRemoteVideoFullscreenControls() {
    const audioBtn = document.getElementById('rvfToggleAudioBtn');
    const videoBtn = document.getElementById('rvfToggleVideoBtn');
    
    if (audioBtn) {
        if (isAudioEnabled) {
            audioBtn.classList.remove('muted');
        } else {
            audioBtn.classList.add('muted');
        }
    }
    
    if (videoBtn) {
        if (isVideoEnabled) {
            videoBtn.classList.remove('muted');
        } else {
            videoBtn.classList.add('muted');
        }
    }
}

if (acceptCallBtn) {
    acceptCallBtn.addEventListener('click', () => {
        console.log('✅ User clicked ACCEPT');
        if (pendingCallResolve) {
            pendingCallResolve(true);
            hideIncomingCallModal();
        }
    });
}

if (rejectCallBtn) {
    rejectCallBtn.addEventListener('click', () => {
        console.log('❌ User clicked REJECT');
        if (pendingCallResolve) {
            pendingCallResolve(false);
            hideIncomingCallModal();
        }
    });
}

// ==================== Export untuk digunakan oleh Chat & ScreenShare ====================

window.VideoCall = {
    handleVideoSignal,
    joinVideoCall,
    startVideoCall,
    endCall,
    toggleAudio,
    toggleVideo,
    getPeerConnection,
    getLocalStream,
    getRemoteUserId: () => remoteUserId,
    isAudioEnabled: getIsAudioEnabled,
    isVideoEnabled: getIsVideoEnabled
};
