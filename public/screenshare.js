// ==================== Screen Share Module ====================
// File ini berisi semua logic untuk screen sharing

// ==================== Screen Share State ====================
let screenStream = null;
let isScreenSharing = false;
let isScreenShareMinimized = false;
let originalVideoTrack = null;
let screenShareMode = null; // 'video' atau 'audio'

// ==================== DOM Elements ====================
const screenShareModal = document.getElementById('screenShareModal');

// ==================== Screen Share Functions ====================

async function startScreenShare(mode = 'video') {
    // mode: 'video' untuk video call, 'audio' untuk audio call
    screenShareMode = mode;
    
    // Check if connected
    const peerConnection = mode === 'video' 
        ? (window.VideoCall && window.VideoCall.getPeerConnection ? window.VideoCall.getPeerConnection() : null)
        : (window.AudioCall && window.AudioCall.getPeerConnection ? window.AudioCall.getPeerConnection() : null);
    
    if (!peerConnection) {
        alert('Belum terhubung dengan teman!');
        return false;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: true
        });

        const videoTrack = screenStream.getVideoTracks()[0];
        
        // For video call, replace the video track
        if (mode === 'video') {
            const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                originalVideoTrack = sender.track;
                await sender.replaceTrack(videoTrack);
            }
        } else {
            // For audio call, add video track and renegotiate
            screenShareSenders = [];
            screenStream.getTracks().forEach(track => {
                const sender = peerConnection.addTrack(track, screenStream);
                screenShareSenders.push(sender);
            });
            
            // Renegotiate the connection to send the new track
            await renegotiateAudioCall(peerConnection);
        }

        // Show screen share modal
        showScreenShareModal();
        isScreenSharing = true;

        // Update button in video call controls if exists
        updateShareButton(true);

        // Notify remote peer that screen share started
        sendScreenShareSignal(true, mode);

        videoTrack.onended = () => {
            stopScreenShare();
        };

        if (window.Chat) {
            window.Chat.renderSystemMessage('Berbagi layar dimulai');
        }

        return true;
    } catch (e) {
        console.error('Gagal berbagi layar:', e);
        if (e.name !== 'NotAllowedError') {
            alert('Gagal berbagi layar. Coba lagi!');
        }
        return false;
    }
}

// Renegotiate audio call connection to send new tracks
async function renegotiateAudioCall(peerConnection) {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Send the new offer to remote peer
        const remoteUserId = window.AudioCall && window.AudioCall.getRemoteUserId ? window.AudioCall.getRemoteUserId() : null;
        if (remoteUserId && window.Chat) {
            const ws = window.Chat.getWebSocket();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    to: remoteUserId,
                    content: JSON.stringify({ type: 'audio-offer', sdp: offer.sdp })
                }));
                console.log('📤 Sent renegotiation offer for screen share');
            }
        }
    } catch (e) {
        console.error('Renegotiation failed:', e);
    }
}

let screenShareSenders = []; // Track senders added for audio call screen share

async function stopScreenShare() {
    if (!isScreenSharing) return;

    // Hide screen share modal
    hideScreenShareModal();

    const peerConnection = screenShareMode === 'video' 
        ? (window.VideoCall && window.VideoCall.getPeerConnection ? window.VideoCall.getPeerConnection() : null)
        : (window.AudioCall && window.AudioCall.getPeerConnection ? window.AudioCall.getPeerConnection() : null);

    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    // Restore original video track for video call
    if (screenShareMode === 'video' && peerConnection && originalVideoTrack) {
        const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            await sender.replaceTrack(originalVideoTrack);
        }
        
        // Restore local video display
        const localVideo = document.getElementById('localVideo');
        const localStream = window.VideoCall && window.VideoCall.getLocalStream ? window.VideoCall.getLocalStream() : null;
        if (localVideo && localStream) {
            localVideo.srcObject = localStream;
        }
    }
    
    // For audio call, remove the screen share tracks
    if (screenShareMode === 'audio' && peerConnection && screenShareSenders.length > 0) {
        screenShareSenders.forEach(sender => {
            try {
                peerConnection.removeTrack(sender);
            } catch (e) {
                console.error('Error removing track:', e);
            }
        });
        screenShareSenders = [];
        
        // Renegotiate to inform remote that tracks are removed
        await renegotiateAudioCall(peerConnection);
    }

    // Notify remote peer that screen share stopped
    sendScreenShareSignal(false, screenShareMode);

    isScreenSharing = false;
    screenShareMode = null;
    originalVideoTrack = null;
    
    // Update button
    updateShareButton(false);

    if (window.Chat) {
        window.Chat.renderSystemMessage('Berbagi layar dihentikan');
    }
}

function toggleScreenShare(mode = 'video') {
    if (!isScreenSharing) {
        startScreenShare(mode);
    } else {
        stopScreenShare();
    }
}

// ==================== Screen Share Modal Functions ====================

function showScreenShareModal() {
    const modal = document.getElementById('screenShareModal');
    const screenShareVideo = document.getElementById('screenShareVideo');
    const screenShareLocalVideo = document.getElementById('screenShareLocalVideo');
    const pipContainer = document.getElementById('screenShareLocalPip');
    
    // Set screen stream to main video
    if (screenStream) {
        screenShareVideo.srcObject = screenStream;
    }
    
    // Set local camera to PIP (only for video call mode)
    if (screenShareMode === 'video') {
        const localStream = window.VideoCall && window.VideoCall.getLocalStream ? window.VideoCall.getLocalStream() : null;
        if (localStream && screenShareLocalVideo) {
            screenShareLocalVideo.srcObject = localStream;
        }
        if (pipContainer) {
            pipContainer.style.display = 'block';
        }
    } else {
        // Hide PIP for audio call (no camera)
        if (pipContainer) {
            pipContainer.style.display = 'none';
        }
    }
    
    // Update control states
    updateScreenShareControls();
    
    // Update label
    const label = document.getElementById('screenShareLabel');
    if (label) {
        label.textContent = screenShareMode === 'video' ? 'Berbagi Layar - Video Call' : 'Berbagi Layar - Audio Call';
    }
    
    modal.classList.add('active');
    modal.classList.remove('minimized');
    isScreenShareMinimized = false;
}

function hideScreenShareModal() {
    const modal = document.getElementById('screenShareModal');
    modal.classList.remove('active', 'minimized');
    
    // Exit fullscreen if in fullscreen
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
}

function toggleScreenShareFullscreen() {
    const modal = document.getElementById('screenShareModal');
    
    if (!document.fullscreenElement) {
        modal.requestFullscreen().catch(err => {
            console.error('Fullscreen error:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

function toggleScreenShareMinimize() {
    const modal = document.getElementById('screenShareModal');
    
    // Exit fullscreen first if in fullscreen
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
    
    isScreenShareMinimized = !isScreenShareMinimized;
    modal.classList.toggle('minimized', isScreenShareMinimized);
}

function updateShareButton(sharing) {
    const btn = document.getElementById('shareScreenBtn');
    if (!btn) return;
    
    if (sharing) {
        btn.classList.add('sharing');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>Stop Share</span>
        `;
    } else {
        btn.classList.remove('sharing');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>Share</span>
        `;
    }
    
    // Also update audio call share button if exists
    const audioShareBtn = document.getElementById('audioShareScreenBtn');
    if (audioShareBtn) {
        if (sharing) {
            audioShareBtn.classList.add('sharing');
            audioShareBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                <span>Stop</span>
            `;
        } else {
            audioShareBtn.classList.remove('sharing');
            audioShareBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                <span>Share</span>
            `;
        }
    }
}

function updateScreenShareControls() {
    const audioBtn = document.getElementById('ssToggleAudioBtn');
    const videoBtn = document.getElementById('ssToggleVideoBtn');
    
    // Use receiverScreenShareMode if receiving, otherwise use screenShareMode
    const mode = isReceivingScreenShare ? receiverScreenShareMode : screenShareMode;
    
    // Get current states from VideoCall or AudioCall
    let isAudioEnabled = true;
    let isVideoEnabled = true;
    
    if (mode === 'video' && window.VideoCall) {
        isAudioEnabled = window.VideoCall.isAudioEnabled ? window.VideoCall.isAudioEnabled() : true;
        isVideoEnabled = window.VideoCall.isVideoEnabled ? window.VideoCall.isVideoEnabled() : true;
    } else if (mode === 'audio' && window.AudioCall) {
        isAudioEnabled = window.AudioCall.isAudioEnabled ? window.AudioCall.isAudioEnabled() : true;
        isVideoEnabled = false; // No video in audio call
    }
    
    // Update audio button state
    if (audioBtn) {
        if (isAudioEnabled) {
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
        } else {
            audioBtn.classList.add('muted');
            audioBtn.innerHTML = `
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
    
    // Update video button state (hide for audio call)
    if (videoBtn) {
        if (mode === 'audio') {
            videoBtn.style.display = 'none';
        } else {
            videoBtn.style.display = 'flex';
            if (isVideoEnabled) {
                videoBtn.classList.remove('muted');
                videoBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="23 7 16 12 23 17 23 7"></polygon>
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                    </svg>
                    <span>Kamera</span>
                `;
            } else {
                videoBtn.classList.add('muted');
                videoBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                    </svg>
                    <span>Kamera Off</span>
                `;
            }
        }
    }
}

function ssToggleAudio() {
    // Use receiverScreenShareMode if receiving, otherwise use screenShareMode
    const mode = isReceivingScreenShare ? receiverScreenShareMode : screenShareMode;
    
    if (mode === 'video' && window.VideoCall && window.VideoCall.toggleAudio) {
        window.VideoCall.toggleAudio();
    } else if (mode === 'audio' && window.AudioCall && window.AudioCall.toggleMute) {
        window.AudioCall.toggleMute();
    }
    updateScreenShareControls();
}

function ssToggleVideo() {
    // Use receiverScreenShareMode if receiving, otherwise use screenShareMode
    const mode = isReceivingScreenShare ? receiverScreenShareMode : screenShareMode;
    
    if (mode === 'video' && window.VideoCall && window.VideoCall.toggleVideo) {
        window.VideoCall.toggleVideo();
        
        // Update PIP opacity
        const pipBox = document.getElementById('screenShareLocalPip');
        const isVideoEnabled = window.VideoCall.isVideoEnabled ? window.VideoCall.isVideoEnabled() : true;
        if (pipBox) {
            pipBox.style.opacity = isVideoEnabled ? '1' : '0.5';
        }
    }
    updateScreenShareControls();
}

function ssEndCall() {
    // Use receiverScreenShareMode if receiving, otherwise use screenShareMode
    const mode = isReceivingScreenShare ? receiverScreenShareMode : screenShareMode;
    
    // If receiving, just hide the modal
    if (isReceivingScreenShare) {
        hideReceiverScreenShareModal();
    } else {
        stopScreenShare();
    }
    
    if (mode === 'video' && window.VideoCall && window.VideoCall.endCall) {
        window.VideoCall.endCall();
    } else if (mode === 'audio' && window.AudioCall && window.AudioCall.endAudioCall) {
        window.AudioCall.endAudioCall();
    }
}

// ==================== Getters ====================

function getScreenStream() {
    return screenStream;
}

function getIsScreenSharing() {
    return isScreenSharing;
}

function getScreenShareMode() {
    return screenShareMode;
}

// ==================== Screen Share Signaling ====================

// Send screen share status to remote peer
function sendScreenShareSignal(isStarting, mode) {
    const ws = window.Chat ? window.Chat.getWebSocket() : null;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const remoteUserId = mode === 'video' 
        ? (window.VideoCall && window.VideoCall.getRemoteUserId ? window.VideoCall.getRemoteUserId() : null)
        : (window.AudioCall && window.AudioCall.getRemoteUserId ? window.AudioCall.getRemoteUserId() : null);

    if (remoteUserId) {
        ws.send(JSON.stringify({
            type: 'signal',
            to: remoteUserId,
            content: JSON.stringify({ 
                type: 'screen-share-status', 
                isSharing: isStarting,
                mode: mode
            })
        }));
        console.log('📤 Sent screen share signal:', isStarting ? 'started' : 'stopped');
    }
}

// Handle incoming screen share signal from remote peer
function handleScreenShareSignal(data) {
    console.log('📥 Received screen share signal:', data);
    
    if (data.isSharing) {
        // Remote started screen sharing - show receiver modal
        showReceiverScreenShareModal(data.mode);
        if (window.Chat) {
            window.Chat.renderSystemMessage('Teman mulai berbagi layar');
        }
    } else {
        // Remote stopped screen sharing - hide receiver modal
        hideReceiverScreenShareModal();
        if (window.Chat) {
            window.Chat.renderSystemMessage('Teman berhenti berbagi layar');
        }
    }
}

// State for receiving screen share
let isReceivingScreenShare = false;
let receiverScreenShareMode = null;

// Show screen share modal for receiver (different from sender's modal)
function showReceiverScreenShareModal(mode) {
    receiverScreenShareMode = mode;
    isReceivingScreenShare = true;
    
    const modal = document.getElementById('screenShareModal');
    const screenShareVideo = document.getElementById('screenShareVideo');
    const pipContainer = document.getElementById('screenShareLocalPip');
    const screenShareLocalVideo = document.getElementById('screenShareLocalVideo');
    
    // For receiver, the remote video is the screen share
    // Get remote video stream and display it
    if (mode === 'video') {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && remoteVideo.srcObject) {
            screenShareVideo.srcObject = remoteVideo.srcObject;
        }
        
        // Show local camera in PIP
        const localStream = window.VideoCall && window.VideoCall.getLocalStream ? window.VideoCall.getLocalStream() : null;
        if (localStream && screenShareLocalVideo) {
            screenShareLocalVideo.srcObject = localStream;
        }
        if (pipContainer) {
            pipContainer.style.display = 'block';
        }
    } else {
        // Audio call mode - remote stream has video now
        const peerConnection = window.AudioCall && window.AudioCall.getPeerConnection ? window.AudioCall.getPeerConnection() : null;
        if (peerConnection) {
            const receivers = peerConnection.getReceivers();
            const videoReceiver = receivers.find(r => r.track && r.track.kind === 'video');
            if (videoReceiver) {
                const stream = new MediaStream([videoReceiver.track]);
                screenShareVideo.srcObject = stream;
            }
        }
        if (pipContainer) {
            pipContainer.style.display = 'none';
        }
    }
    
    if (modal) {
        modal.classList.add('active');
        modal.classList.remove('fullscreen');
        modal.classList.remove('minimized');
    }

    // Update modal title to indicate receiving
    const modalTitle = document.getElementById('screenShareLabel');
    if (modalTitle) {
        modalTitle.textContent = 'Teman Berbagi Layar';
    }

    // Hide the stop share button for receiver (they can't stop remote's share)
    const stopShareBtn = document.getElementById('ssStopShareBtn');
    if (stopShareBtn) {
        stopShareBtn.style.display = 'none';
    }

    // Update controls state
    updateScreenShareControls();
}

// Hide receiver screen share modal
function hideReceiverScreenShareModal() {
    isReceivingScreenShare = false;
    receiverScreenShareMode = null;
    
    const modal = document.getElementById('screenShareModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('fullscreen');
        modal.classList.remove('minimized');
    }

    // Restore modal title
    const modalTitle = document.getElementById('screenShareLabel');
    if (modalTitle) {
        modalTitle.textContent = 'Berbagi Layar';
    }

    // Show the stop share button again
    const stopShareBtn = document.getElementById('ssStopShareBtn');
    if (stopShareBtn) {
        stopShareBtn.style.display = '';
    }
}

function getIsReceivingScreenShare() {
    return isReceivingScreenShare;
}

// ==================== Event Listeners ====================

// Safely attach event listeners (check if elements exist)
const ssFullscreenBtn = document.getElementById('ssToggleFullscreenBtn');
const ssMinBtn = document.getElementById('ssMinimizeBtn');
const ssAudioBtn = document.getElementById('ssToggleAudioBtn');
const ssVideoBtn = document.getElementById('ssToggleVideoBtn');
const ssStopBtn = document.getElementById('ssStopShareBtn');
const ssHangBtn = document.getElementById('ssHangupBtn');

if (ssFullscreenBtn) ssFullscreenBtn.addEventListener('click', toggleScreenShareFullscreen);
if (ssMinBtn) ssMinBtn.addEventListener('click', toggleScreenShareMinimize);
if (ssAudioBtn) ssAudioBtn.addEventListener('click', ssToggleAudio);
if (ssVideoBtn) ssVideoBtn.addEventListener('click', ssToggleVideo);
if (ssStopBtn) ssStopBtn.addEventListener('click', stopScreenShare);
if (ssHangBtn) ssHangBtn.addEventListener('click', ssEndCall);

// ==================== Export ====================

window.ScreenShare = {
    startScreenShare,
    stopScreenShare,
    toggleScreenShare,
    showScreenShareModal,
    hideScreenShareModal,
    toggleScreenShareFullscreen,
    toggleScreenShareMinimize,
    updateScreenShareControls,
    getScreenStream,
    getIsScreenSharing,
    getScreenShareMode,
    handleScreenShareSignal,
    hideReceiverScreenShareModal,
    getIsReceivingScreenShare
};
