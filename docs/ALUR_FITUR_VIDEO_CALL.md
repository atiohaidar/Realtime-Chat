# 📹 Dokumentasi Alur Fitur Video Call

Dokumen ini menjelaskan alur lengkap fitur video call (WebRTC) pada aplikasi Notebook Chat.

---

## 📖 Pengantar

Bayangkan kamu ingin video call dengan teman. Di aplikasi biasa seperti Zoom, semua video melewati server perusahaan. Tapi di aplikasi ini, setelah koneksi awal terbentuk, video kamu langsung mengalir ke teman kamu **tanpa melewati server** - ini disebut **Peer-to-Peer (P2P)**.

Analoginya seperti ini:
- **Panggilan telepon biasa**: Kamu bicara → Operator → Teman (semua lewat operator)
- **Video call WebRTC**: Kamu bicara → Teman langsung! (operator cuma membantu di awal untuk menghubungkan)

Server hanya berperan sebagai "mak comblang" yang memperkenalkan kedua pihak. Setelah kenal, mereka ngobrol langsung tanpa perantara!

---

## 🏗️ Arsitektur Video Call

```
┌─────────────┐                                              ┌─────────────┐
│   User A    │                                              │   User B    │
│  (Caller)   │                                              │  (Callee)   │
└──────┬──────┘                                              └──────┬──────┘
       │                                                            │
       │              ┌─────────────────────────┐                   │
       │              │    Signaling Server     │                   │
       │              │   (Durable Object)      │                   │
       │              └───────────┬─────────────┘                   │
       │                          │                                 │
       │◄─────────────────────────┴────────────────────────────────►│
       │           WebSocket (Signaling)                            │
       │                                                            │
       │◄══════════════════════════════════════════════════════════►│
       │           Peer-to-Peer (Media Stream via WebRTC)           │
       │                                                            │
```

### 🎯 Penjelasan Komponen:

1. **Signaling Server (Durable Object)** 
   > Ini adalah "mak comblang" yang memperkenalkan User A dan User B. Tugasnya hanya menyampaikan informasi tentang bagaimana cara menghubungi masing-masing (alamat IP, port, codec yang didukung, dll).

2. **WebRTC** 
   > Teknologi browser yang memungkinkan video/audio mengalir langsung antar browser tanpa melewati server. Setelah koneksi terbentuk, server tidak lagi terlibat dalam pengiriman video!

3. **STUN Servers** 
   > Server publik (milik Google) yang membantu menemukan alamat IP publik kamu. Bayangkan ini seperti bertanya "Eh, alamat rumahku apa sih?" ke orang lain, karena kamu sendiri tidak tahu alamat publikmu.

4. **Client** 
   > Browser yang menjalankan kode JavaScript untuk mengakses kamera, mengelola koneksi, dan menampilkan video.

### Komponen Utama:
1. **Signaling Server** - Durable Object (`src/chat.ts`)
2. **WebRTC** - Peer-to-peer media connection
3. **STUN Servers** - Google's public STUN servers
4. **Client** - `public/client.js`

---

## 🔄 Alur Video Call Lengkap

> 💡 **Gambaran Besar:** Video call terjadi dalam 6 fase utama. Analogi Mak Comblang:
> 1. User A siap-siap (nyalakan kamera) dan minta mak comblang carikan teman
> 2. User B tertarik dan siap-siap juga
> 3. Mak comblang memperkenalkan keduanya (signaling)
> 4. User A menerima perkenalan
> 5. Mereka bertukar "alamat rumah" (ICE candidates)
> 6. Akhirnya bisa video call langsung tanpa mak comblang!

### Fase 1: Inisiasi Panggilan (Caller Side)

> 💡 **Narasi:** User A ingin video call. Pertama, dia harus minta izin menggunakan kamera dan mikrofon. Setelah itu, browser menampilkan preview video diri sendiri. Kemudian, User A mengirim pesan ke chat "📞 [KLIK DI SINI]" sebagai undangan. Ini seperti posting di grup "Siapa mau video call?"

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         FASE 1: INISIASI PANGGILAN                        │
└───────────────────────────────────────────────────────────────────────────┘

[User A - Caller]
       │
       │  1. Klik tombol Video Call
       ▼
┌─────────────────────────────┐
│  getUserMedia()             │
│  - Request kamera + mic     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Set localVideo.srcObject   │
│  = localStream              │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Show video call container  │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Send chat message:         │
│  "📞 [KLIK DI SINI]"        │
│  metadata: {action:         │
│    'join_call'}             │
└─────────────────────────────┘
```

**Apa yang terjadi step-by-step:**
1. User A menekan tombol video call
2. Browser minta izin akses kamera dan mikrofon
3. Setelah diizinkan, video dari kamera ditampilkan di `localVideo`
4. Container video call muncul di layar
5. Pesan undangan dikirim ke chat agar orang lain bisa bergabung

**Kode Terkait:**

```javascript
// client.js - Memulai video call
async function startVideoCall() {
    try {
        // Request akses kamera dan mic
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        document.getElementById('localVideo').srcObject = localStream;

        // Reset state
        isAudioEnabled = true;
        isVideoEnabled = true;
        resetVideoControls();

        // Tampilkan container video
        document.getElementById('videoCallContainer').classList.add('active');

        // Kirim pesan ajakan ke chat
        ws.send(JSON.stringify({
            type: 'message',
            content: '📞 [KLIK DI SINI] ',
            metadata: { action: 'join_call' }
        }));

        renderSystemMessage('Menunggu orang lain bergabung...');
    } catch (e) {
        alert('Gagal akses kamera/mic!');
    }
}
```

---

### Fase 2: User B Menerima Undangan

> 💡 **Narasi:** User B melihat pesan "📞 [KLIK DI SINI]" di chat dan tertarik untuk bergabung. Ketika diklik, browser User B juga minta izin kamera/mikrofon. Setelah itu, User B membuat "tawaran" (offer) yang berisi informasi tentang kemampuan browsernya: codec video apa yang didukung, resolusi maksimal, dll. Tawaran ini dikirim ke User A melalui server (signaling).
>

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      FASE 2: MENERIMA UNDANGAN                            │
└───────────────────────────────────────────────────────────────────────────┘

[User B - Callee]
       │
       │  1. Melihat pesan "📞 [KLIK DI SINI]"
       │     di chat
       ▼
┌─────────────────────────────┐
│  Klik pada bubble message   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  joinVideoCall(targetUserId,│
│              username)      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  getUserMedia()             │
│  - Request kamera + mic     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  createPeerConnection()     │
│  - Setup RTCPeerConnection  │
│  - Add local tracks         │
│  - Setup event handlers     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  createOffer()              │
│  - Generate SDP offer       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  setLocalDescription(offer) │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  sendSignal(targetId, {     │
│    type: 'offer',           │
│    sdp: offer.sdp           │
│  })                         │
└─────────────────────────────┘
```

**Apa yang terjadi step-by-step:**
1. User B melihat pesan undangan di chat
2. Klik pada bubble message yang ada metadata `join_call`
3. Browser minta izin kamera/mikrofon
4. **createPeerConnection()**: Membuat objek RTCPeerConnection - ini adalah "telepon" virtual
5. Menambahkan track video/audio lokal ke connection
6. **createOffer()**: Membuat SDP offer (Session Description Protocol) - berisi informasi codec, resolusi, dll
7. **setLocalDescription()**: Menyimpan offer sebagai deskripsi lokal
8. **sendSignal()**: Mengirim offer ke User A via WebSocket

**Kode Terkait:**

```javascript
// client.js - Bergabung ke video call
async function joinVideoCall(targetUserId, username) {
    remoteUserId = targetUserId;
    
    // Request media jika belum ada
    if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, audio: true 
        });
        document.getElementById('localVideo').srcObject = localStream;
    }

    // Setup UI
    document.getElementById('videoCallContainer').classList.add('active');
    document.getElementById('remoteLabel').textContent = username;
    
    // Buat peer connection
    createPeerConnection(targetUserId);

    // Buat dan kirim offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal(targetUserId, { type: 'offer', sdp: offer.sdp });
}
```

---

### Fase 3: Signaling via WebSocket

> 💡 **Narasi:** Di fase ini, server berperan sebagai "kurir" yang menyampaikan pesan antara User A dan User B. Server TIDAK melihat isi video - hanya menyampaikan informasi teknis (SDP dan ICE candidates). 
>
> Prosesnya seperti ini:
> 1. User B kirim "offer" (tawaran) ke server
> 2. Server teruskan ke User A
> 3. User A terima, tampilkan modal "Panggilan Masuk dari B"
> 4. User A terima panggilan, kirim "answer" (jawaban) balik
> 5. Keduanya bertukar ICE candidates (alamat jaringan)
>
> **Analogi:** Seperti tukar nomor telepon melalui teman - teman hanya menyampaikan nomor, tidak ikut mendengarkan percakapan nanti.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      FASE 3: WEBRTC SIGNALING                             │
└───────────────────────────────────────────────────────────────────────────┘

[User B]                   [Durable Object]                   [User A]
    │                            │                                │
    │  signal {                  │                                │
    │    type: 'offer',          │                                │
    │    to: userA_id,           │                                │
    │    sdp: '...'              │                                │
    │  }                         │                                │
    ├───────────────────────────►│                                │
    │                            │                                │
    │                            │  Forward ke User A             │
    │                            │  (filter by to: userId)        │
    │                            ├───────────────────────────────►│
    │                            │                                │
    │                            │                                │  Show incoming
    │                            │                                │  call modal
    │                            │                                │
    │                            │                                │  [User accepts]
    │                            │                                │
    │                            │  signal {                      │
    │                            │    type: 'answer',             │
    │                            │    sdp: '...'                  │
    │                            │  }                             │
    │                            │◄───────────────────────────────┤
    │                            │                                │
    │  Receive answer            │                                │
    │◄───────────────────────────┤                                │
    │                            │                                │
    │                            │  ICE Candidates exchange       │
    │◄───────────────────────────┼───────────────────────────────►│
    │                            │                                │
```

**Istilah Penting:**
- **SDP (Session Description Protocol)**: Informasi tentang kemampuan media (codec, resolusi, dll)
- **ICE Candidates**: Alamat jaringan yang mungkin bisa digunakan untuk koneksi langsung
- **Signal**: Pesan yang dikirim via WebSocket untuk koordinasi koneksi

**Kode Terkait (Server):**

```typescript
// chat.ts - Handle signal message di Durable Object
case 'signal':
    // WebRTC signaling: forward signal ke user tertentu
    if (data.to) {
        const targetSession = Array.from(this.ctx.getWebSockets()).find(socket => {
            const sess = socket.deserializeAttachment() as SessionData | null;
            return sess?.userId === data.to;
        });

        if (targetSession && targetSession.readyState === WebSocket.OPEN) {
            targetSession.send(JSON.stringify({
                type: 'signal',
                userId: session.userId,
                username: session.username,
                color: session.color,
                content: data.content,
                timestamp: Date.now()
            }));
        }
    }
    break;
```

**Kode Terkait (Client):**

```javascript
// client.js - Kirim signal
function sendSignal(to, content) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: 'signal',
        to: to,
        content: JSON.stringify(content)
    }));
}
```

---

### Fase 4: User A Menerima Panggilan

> 💡 **Narasi:** User A menerima "offer" dari User B. Browser menampilkan modal "Panggilan Masuk dari User B" dengan tombol Accept dan Reject. 
>
> Jika **ACCEPT**: 
> - Minta izin kamera/mikrofon
> - Simpan offer User B sebagai "remote description"
> - Buat "answer" yang berisi kemampuan User A
> - Kirim answer balik ke User B
>
> Jika **REJECT**:
> - Kirim sinyal "reject" ke User B
> - User B akan melihat notifikasi bahwa panggilan ditolak
>
> **Analogi:** Seperti menerima telepon - kamu bisa angkat (accept) atau reject.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    FASE 4: INCOMING CALL HANDLING                         │
└───────────────────────────────────────────────────────────────────────────┘

[User A - Caller, menerima offer dari User B]
       │
       │  Receive signal type: 'offer'
       ▼
┌─────────────────────────────┐
│  showIncomingCallModal()    │
│  - Display caller name      │
│  - Show Accept/Reject btns  │
└─────────────┬───────────────┘
              │
              ▼
       ┌──────┴──────┐
       │   ACCEPT?   │
       └──────┬──────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
[ACCEPT]           [REJECT]
     │                 │
     ▼                 ▼
┌──────────────┐  ┌──────────────┐
│getUserMedia()│  │sendSignal({  │
│              │  │ type:'reject'│
│setRemoteDesc │  │})            │
│(offer)       │  └──────────────┘
│              │
│createAnswer()│
│              │
│setLocalDesc  │
│(answer)      │
│              │
│sendSignal({  │
│ type:'answer'│
│ sdp: ...     │
│})            │
└──────────────┘
```

**Apa yang terjadi jika ACCEPT:**
1. **showIncomingCallModal()**: Tampilkan modal dengan nama pemanggil
2. **getUserMedia()**: Minta izin kamera/mikrofon
3. **setRemoteDescription()**: Simpan kemampuan User B
4. **Process ICE queue**: Proses ICE candidates yang sudah datang duluan
5. **createAnswer()**: Buat jawaban berdasarkan kemampuan kedua pihak
6. **setLocalDescription()**: Simpan answer sebagai deskripsi lokal
7. **sendSignal()**: Kirim answer ke User B

**Kode Terkait:**

```javascript
// client.js - Handle incoming video signal
async function handleVideoSignal(data) {
    const signal = JSON.parse(data.content);
    const from = data.userId;

    if (signal.type === 'offer') {
        // Tampilkan modal incoming call
        const accepted = await showIncomingCallModal(data.username);

        if (accepted) {
            // Request media
            if (!localStream) {
                localStream = await navigator.mediaDevices.getUserMedia({ 
                    video: true, audio: true 
                });
                document.getElementById('localVideo').srcObject = localStream;
            }

            // Setup peer connection
            createPeerConnection(from);
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(signal)
            );

            // Process queued ICE candidates
            while (iceCandidatesQueue.length > 0) {
                const cand = iceCandidatesQueue.shift();
                await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            }

            // Buat dan kirim answer
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            sendSignal(from, { type: 'answer', sdp: answer.sdp });
        } else {
            // User menolak
            sendSignal(from, { type: 'reject' });
        }
    }
}
```

---

### Fase 5: ICE Candidate Exchange

> 💡 **Narasi:** Ini adalah fase paling teknis! ICE (Interactive Connectivity Establishment) adalah proses mencari "jalan" terbaik untuk koneksi langsung antara User A dan User B.
>
> Bayangkan kamu dan teman tinggal di kota berbeda. Ada banyak jalan yang bisa ditempuh:
> - Jalan tol langsung (koneksi LAN jika di jaringan yang sama)
> - Jalan biasa lewat server (via STUN)
> - Jalan memutar lewat relay (TURN server, jika diperlukan)
>
> Browser mencoba SEMUA kemungkinan jalur dan memilih yang tercepat. Setiap "jalan" yang ditemukan disebut ICE Candidate, dan dikirim ke pihak lain untuk dicoba.
>
> **Kenapa ada queue?** Kadang ICE candidates datang sebelum offer/answer selesai diproses. Jadi kita simpan dulu di antrian, baru diproses setelah remote description ter-set.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    FASE 5: ICE CANDIDATE EXCHANGE                         │
└───────────────────────────────────────────────────────────────────────────┘

[User A]                                                      [User B]
    │                                                            │
    │  RTCPeerConnection.onicecandidate                          │
    │  - Event fired untuk setiap candidate                      │
    ▼                                                            │
┌────────────────┐                                               │
│ sendSignal({   │                                               │
│   type:        │                                               │
│    'candidate',│                                               │
│   candidate:   │─────────────► [Durable Object] ──────────────►│
│     {...}      │                                               │
│ })             │                                               │
└────────────────┘                                               │
    │                                                            │
    │                                               ┌────────────┴────────────┐
    │                                               │ peerConnection          │
    │                                               │ .addIceCandidate()      │
    │                                               │                         │
    │◄─────────────────────────────────────────────│ sendSignal({            │
    │               [Durable Object]               │   type: 'candidate',    │
    │                                               │   candidate: {...}      │
    │                                               │ })                      │
    ▼                                               └─────────────────────────┘
┌────────────────┐
│ peerConnection │
│ .addIceCandidate│
│ ()             │
└────────────────┘
```

**Apa yang terjadi:**
1. Browser menemukan alamat jaringan (ICE candidate)
2. Event `onicecandidate` dipanggil
3. Candidate dikirim ke pihak lain via signaling server
4. Pihak lain menerima dan menambahkannya dengan `addIceCandidate()`
5. Proses ini terjadi BERKALI-KALI sampai koneksi terbaik ditemukan
6. Jika candidate datang sebelum siap, disimpan di queue (max 50 untuk cegah memory leak)

**Kode Terkait:**

```javascript
// client.js - Setup peer connection
function createPeerConnection(targetUserId) {
    remoteUserId = targetUserId;

    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        const remoteVid = document.getElementById('remoteVideo');
        remoteVid.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(targetUserId, { 
                type: 'candidate', 
                candidate: event.candidate 
            });
        }
    };

    // Monitor connection state
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'connected') {
            renderSystemMessage('Terhubung dengan teman!');
        } else if (peerConnection.iceConnectionState === 'failed') {
            renderSystemMessage('Koneksi gagal. Coba lagi.');
        }
    };
}
```

---

### Fase 6: Media Stream Established

> 💡 **Narasi:** Selamat! 🎉 Setelah semua fase sebelumnya selesai, koneksi P2P (Peer-to-Peer) berhasil terbentuk! Sekarang video dan audio mengalir LANGSUNG antara User A dan User B **tanpa melewati server sama sekali**.
>
> Ini adalah keajaiban WebRTC - bandwidth server tidak terpakai untuk video, hanya untuk signaling awal. Kamu bisa video call berjam-jam tanpa membebani server!
>
> **Status koneksi yang mungkin:**
> - `connected` / `completed` - Berhasil terhubung! 🟢
> - `disconnected` - Koneksi terputus sementara 🟡
> - `failed` - Gagal total, perlu coba lagi 🔴

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    FASE 6: P2P MEDIA STREAMING                            │
└───────────────────────────────────────────────────────────────────────────┘

[User A]                                                      [User B]
    │                                                            │
    │◄═══════════════════════════════════════════════════════════│
    │                Direct P2P Connection                       │
    │═══════════════════════════════════════════════════════════►│
    │                                                            │
    │  ┌─────────────────────────────────────────────────────┐   │
    │  │              VIDEO + AUDIO STREAM                   │   │
    │  │                                                     │   │
    │  │   localVideo  ──────────────────►  remoteVideo     │   │
    │  │                                                     │   │
    │  │   remoteVideo ◄──────────────────  localVideo      │   │
    │  │                                                     │   │
    │  └─────────────────────────────────────────────────────┘   │
    │                                                            │
```

**Apa yang terjadi:**
1. ICE negotiation selesai - jalur terbaik ditemukan
2. Media stream mulai mengalir secara P2P
3. Video User A tampil di `remoteVideo` User B dan sebaliknya
4. Audio juga mengalir bersamaan
5. Server tidak lagi terlibat dalam transfer media!

---

## 🎛️ Kontrol Video Call

> 💡 **Narasi:** Selama video call berlangsung, user bisa mengontrol mic dan kamera. Perhatikan bahwa kita hanya men-disable track, tidak menghentikan sepenuhnya. Ini membuat switching on/off menjadi instan tanpa perlu reconnect!

### Toggle Audio (Mute/Unmute)

> Mematikan mic tidak menghentikan koneksi, hanya men-disable audio track. Suaramu tidak terkirim, tapi koneksi tetap jalan.

```javascript
// client.js
function toggleAudio() {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isAudioEnabled = !isAudioEnabled;
        audioTrack.enabled = isAudioEnabled;
        
        // Update UI button
        const btn = document.getElementById('toggleAudioBtn');
        btn.classList.toggle('muted', !isAudioEnabled);
    }
}
```

### Toggle Video (Camera On/Off)

> Mematikan kamera juga hanya men-disable video track. Kamera tetap aktif (lampu mungkin masih nyala), tapi frame tidak terkirim.

```javascript
// client.js
function toggleVideo() {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        isVideoEnabled = !isVideoEnabled;
        videoTrack.enabled = isVideoEnabled;
        
        // Update UI
        const btn = document.getElementById('toggleVideoBtn');
        const localVideoBox = document.getElementById('localVideoBox');
        btn.classList.toggle('muted', !isVideoEnabled);
        localVideoBox.classList.toggle('video-off', !isVideoEnabled);
    }
}
```

### End Call

> Mengakhiri panggilan dengan benar sangat penting! Kita harus menutup peer connection DAN menghentikan semua track agar kamera/mic benar-benar mati.

```javascript
// client.js
function endCall() {
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Reset state
    remoteUserId = null;
    iceCandidatesQueue = [];
    isAudioEnabled = true;
    isVideoEnabled = true;

    // Reset UI
    resetVideoControls();
    document.getElementById('videoCallContainer').classList.remove('active');
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
}
```

---

## 📊 Diagram Sequence Lengkap

```
┌─────────┐          ┌─────────────────┐          ┌─────────┐
│ User A  │          │ Durable Object  │          │ User B  │
│(Caller) │          │   (Signaling)   │          │(Callee) │
└────┬────┘          └────────┬────────┘          └────┬────┘
     │                        │                        │
     │  1. Start Call         │                        │
     │  Send chat msg with    │                        │
     │  metadata: join_call   │                        │
     ├───────────────────────►│                        │
     │                        │  Broadcast message     │
     │                        ├───────────────────────►│
     │                        │                        │
     │                        │        2. User B clicks│
     │                        │           join_call    │
     │                        │                        │
     │                        │  3. signal: offer      │
     │                        │◄───────────────────────┤
     │  Forward offer         │                        │
     │◄───────────────────────┤                        │
     │                        │                        │
     │  4. Show modal         │                        │
     │     [Accept/Reject]    │                        │
     │                        │                        │
     │  5. Accept call        │                        │
     │     - getUserMedia     │                        │
     │     - setRemoteDesc    │                        │
     │     - createAnswer     │                        │
     │                        │                        │
     │  6. signal: answer     │                        │
     ├───────────────────────►│                        │
     │                        │  Forward answer        │
     │                        ├───────────────────────►│
     │                        │                        │
     │  7. ICE candidates     │  7. ICE candidates     │
     ├───────────────────────►│◄───────────────────────┤
     │◄───────────────────────┤───────────────────────►│
     │                        │                        │
     │  8. P2P Connection Established                  │
     │◄═══════════════════════════════════════════════►│
     │                        │                        │
     │         VIDEO/AUDIO STREAMING (P2P)             │
     │◄═══════════════════════════════════════════════►│
     │                        │                        │
```

---

## ⚙️ Konfigurasi WebRTC

> 💡 **Narasi:** Konfigurasi ini menentukan bagaimana WebRTC bekerja. STUN server adalah server publik yang membantu menemukan alamat IP publik kamu - gratis dan disediakan Google!

### STUN Servers

> STUN (Session Traversal Utilities for NAT) server membantu browser menemukan alamat IP publiknya. Bayangkan kamu di balik router WiFi - kamu tidak tahu alamat publik routermu. STUN server seperti bertanya ke orang luar "Halo, alamat saya apa ya?"

```javascript
// client.js
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
```

### ICE Candidate Queue

> Kadang ICE candidates datang lebih cepat dari proses offer/answer. Kita simpan di queue dulu, baru diproses setelah remote description siap. Limit 50 untuk mencegah memory leak jika ada bug.

```javascript
// Untuk menangani ICE candidates yang datang sebelum remote description di-set
let iceCandidatesQueue = [];
const MAX_ICE_QUEUE_SIZE = 50; // Prevent memory leak

// Saat menerima candidate
if (peerConnection && peerConnection.remoteDescription) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
} else {
    // Queue jika remote description belum ada
    if (iceCandidatesQueue.length < MAX_ICE_QUEUE_SIZE) {
        iceCandidatesQueue.push(candidate);
    }
}
```

---

## 🔧 State Management

> 💡 **Narasi:** Variabel-variabel ini menyimpan status video call saat ini. Penting untuk di-reset dengan benar saat panggilan berakhir!

```javascript
// Video call state variables
let localStream = null;          // MediaStream dari kamera/mic lokal
let peerConnection = null;       // RTCPeerConnection instance
let remoteUserId = null;         // ID user yang sedang di-call
let iceCandidatesQueue = [];     // Queue untuk ICE candidates
let isAudioEnabled = true;       // Status mic
let isVideoEnabled = true;       // Status kamera

// Incoming call state
let pendingCallData = null;      // Data panggilan masuk
let pendingCallResolve = null;   // Promise resolver untuk modal
```

---

## 📁 File Terkait

| File | Deskripsi |
|------|-----------|
| `src/chat.ts` | Signaling server (handle signal message forwarding) |
| `public/client.js` | WebRTC client logic |
| `public/index.html` | UI video call container |
| `public/style.css` | Styling video call UI |

---

## 🚨 Troubleshooting

> 💡 **Narasi:** WebRTC bisa tricky! Berikut masalah umum dan solusinya:

### Masalah Umum

1. **Kamera/Mic tidak bisa diakses**
   - Pastikan HTTPS (WebRTC membutuhkan secure context)
   - Pastikan permission sudah diberikan di browser
   > *Solusi: Cek icon gembok di address bar, pastikan kamera/mic diizinkan*

2. **Video tidak muncul di remote**
   - Cek ICE connection state
   - Pastikan STUN servers accessible
   - Cek firewall settings

3. **Koneksi gagal (ICE failed)**
   - Mungkin perlu TURN server untuk NAT traversal
   - Network firewall mungkin memblokir UDP

4. **Audio echo**
   - Gunakan headphone
   - Browser biasanya sudah ada echo cancellation

---

## 🔮 Kemungkinan Pengembangan

> 💡 **Narasi:** Fitur video call ini masih bisa dikembangkan lebih lanjut! Berikut beberapa ide:

1. **TURN Server** - Untuk network yang ketat (corporate firewall)
   > *Saat ini hanya pakai STUN. Di jaringan perusahaan yang ketat, mungkin perlu TURN server sebagai relay.*

2. **Screen Sharing** - `getDisplayMedia()` API
   > *Berbagi layar untuk presentasi atau kolaborasi. Tinggal ganti `getUserMedia()` dengan `getDisplayMedia()`.*

3. **Multi-party Call** - Mesh atau SFU architecture
   > *Video call lebih dari 2 orang. Bisa pakai Mesh (semua konek ke semua) atau SFU (server relay).*

4. **Recording** - MediaRecorder API
   > *Merekam video call untuk ditonton nanti. Browser sudah support MediaRecorder API.*

5. **Virtual Background** - Canvas + MediaStreamTrack
   > *Blur atau ganti background seperti di Zoom. Perlu machine learning untuk segmentasi.*

---

## 📚 Kesimpulan

Video call di aplikasi ini menggunakan teknologi WebRTC yang memungkinkan komunikasi peer-to-peer tanpa membebani server. Prosesnya melibatkan:

1. **Signaling** - Server hanya berperan sebagai "mak comblang" untuk memperkenalkan kedua pihak
2. **ICE Negotiation** - Mencari jalur koneksi terbaik antara kedua browser
3. **P2P Media Streaming** - Setelah terhubung, video/audio mengalir langsung tanpa server

Keuntungan utama:
- ✅ Latency rendah (langsung P2P)
- ✅ Hemat bandwidth server
- ✅ Privasi lebih baik (video tidak lewat server)
- ✅ Scalable (server tidak jadi bottleneck untuk media)

Tantangan:
- ⚠️ Tidak selalu bisa P2P (butuh TURN server untuk kasus tertentu)
- ⚠️ Butuh HTTPS untuk akses kamera/mic
- ⚠️ NAT traversal bisa kompleks di beberapa jaringan
