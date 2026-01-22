# 📝 Dokumentasi Alur Fitur Chat

Dokumen ini menjelaskan alur lengkap fitur chat realtime pada aplikasi Notebook Chat.

---

## 📖 Pengantar

Bayangkan kamu sedang menulis di buku catatan bersama teman-teman. Setiap orang bisa menulis pesan, dan semua orang yang membuka buku yang sama bisa langsung melihat tulisan tersebut secara real-time. Itulah konsep dasar dari fitur chat ini!

Fitur chat ini menggunakan teknologi **WebSocket** yang memungkinkan komunikasi dua arah secara real-time antara browser dan server. Berbeda dengan HTTP biasa yang harus "bertanya" terus menerus ke server, WebSocket membuat "jalur telepon" yang tetap terbuka, sehingga server bisa langsung "menelepon" ke browser kapan saja ada pesan baru.

---

## 🏗️ Arsitektur Sistem

```
┌─────────────┐     WebSocket     ┌──────────────────┐     Batch Insert     ┌─────────┐
│   Client    │ ◄──────────────► │  Durable Object  │ ──────────────────► │   D1    │
│ (Browser)   │                   │   (ChatRoom)     │                      │ Database│
└─────────────┘                   └──────────────────┘                      └─────────┘
```

### 🎯 Penjelasan Sederhana:

Sistem chat ini seperti sebuah **ruang kelas virtual** dengan tiga bagian utama:

1. **Client (Browser)** - Ini adalah "meja belajar" setiap siswa. Di sinilah kamu mengetik pesan dan melihat pesan dari orang lain. File `public/client.js` mengatur semua yang terjadi di browser kamu.

2. **Durable Object (ChatRoom)** - Ini adalah "guru" yang mengatur kelas. Durable Object bertanggung jawab untuk:
   - Menerima pesan dari semua siswa
   - Menyebarkan pesan ke semua siswa lain
   - Mencatat siapa saja yang sedang online
   - Mengingat semua pesan meskipun server di-restart

3. **D1 Database** - Ini adalah "buku catatan permanen" guru. Semua pesan disimpan di sini agar tidak hilang dan bisa dibaca lagi nanti.

### Komponen Utama:
1. **Client (Browser)** - `public/client.js`
2. **Worker/Router** - `src/index.ts`
3. **Durable Object** - `src/chat.ts`
4. **Database** - D1 (SQLite)

---

## 🔄 Alur Koneksi (Connection Flow)

### 1. User Membuka Halaman

> 💡 **Narasi:** Ketika kamu membuka aplikasi chat di browser, hal pertama yang terjadi adalah browser meminta halaman HTML dari server. Ini seperti ketika kamu membuka pintu kelas - kamu perlu masuk dulu sebelum bisa ngobrol dengan teman-teman.

```
[Client]                    [Worker]                    [Durable Object]
   │                           │                              │
   │  GET /                    │                              │
   ├──────────────────────────►│                              │
   │  Return index.html        │                              │
   │◄──────────────────────────┤                              │
   │                           │                              │
```

**Apa yang terjadi:**
- Browser mengirim permintaan `GET /` ke server
- Server mengembalikan file `index.html` yang berisi tampilan chat
- Browser merender halaman tersebut di layar kamu

### 2. Establish WebSocket Connection

> 💡 **Narasi:** Setelah halaman terbuka, browser akan membuat "jalur telepon" khusus ke server menggunakan WebSocket. Bayangkan ini seperti mengangkat telepon dan terhubung ke operator yang akan menyampaikan pesanmu ke semua teman di ruangan yang sama. Koneksi ini tetap terbuka selama kamu membuka halaman.

```
[Client]                    [Worker]                    [Durable Object]
   │                           │                              │
   │  WS: /ws?room=general     │                              │
   ├──────────────────────────►│                              │
   │                           │  Get DO by roomId            │
   │                           ├─────────────────────────────►│
   │                           │                              │
   │                           │  Create WebSocketPair        │
   │                           │◄─────────────────────────────┤
   │  WebSocket Upgrade (101)  │                              │
   │◄──────────────────────────┤                              │
   │                           │                              │
```

**Apa yang terjadi:**
1. Browser mengirim permintaan WebSocket ke `/ws?room=general`
2. Worker mencari Durable Object untuk room "general"
3. Durable Object membuat pasangan WebSocket (satu untuk server, satu untuk client)
4. Server mengembalikan response 101 (Switching Protocols) - artinya koneksi berhasil di-upgrade ke WebSocket
5. Sekarang browser dan server bisa saling kirim pesan kapan saja!

**Kode Terkait:**

```javascript
// client.js - Membuat koneksi WebSocket
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?room=${roomId}`;
    ws = new WebSocket(wsUrl);
}
```

```typescript
// chat.ts - Menerima WebSocket di Durable Object
async fetch(request: Request): Promise<Response> {
    if (url.pathname === '/websocket') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        
        // Initialize session
        const sessionData: SessionData = {
            userId: crypto.randomUUID(),
            username: 'Anonymous',
            color: '#3b82f6'
        };
        server.serializeAttachment(sessionData);
        
        return new Response(null, { status: 101, webSocket: client });
    }
}
```

---

## 👤 Alur Identifikasi User

### 3. User Identification

> 💡 **Narasi:** Setelah "telepon" tersambung, kamu perlu memperkenalkan diri. Kamu mengirim informasi tentang siapa kamu (username, warna favorit) ke server. Server kemudian mengumumkan ke semua orang di ruangan bahwa kamu sudah bergabung, dan memberitahumu siapa saja yang sedang online. Ini seperti ketika kamu masuk kelas dan guru mengumumkan "Eh, ada murid baru nih!"

```
[Client]                                      [Durable Object]
   │                                                │
   │  {type: 'identify', userId, username, color}   │
   ├───────────────────────────────────────────────►│
   │                                                │
   │                                                │  Update session
   │                                                │  attachment
   │                                                │
   │                                                │  Broadcast 'join'
   │                                                │  ke semua user lain
   │                                                │
   │  {type: 'online_users', users: [...]}          │
   │◄───────────────────────────────────────────────┤
   │                                                │
```

**Apa yang terjadi:**
1. Browser mengirim data profil (userId, username, warna) ke server
2. Server menyimpan data ini sebagai "attachment" di koneksi WebSocket kamu
3. Server memberitahu semua user lain bahwa kamu baru bergabung (pesan "join")
4. Server mengirim daftar semua user yang sedang online khusus ke kamu
5. Browser menampilkan daftar siapa saja yang online di sidebar

**Kode Terkait:**

```javascript
// client.js - Kirim identifikasi setelah WebSocket open
ws.onopen = () => {
    ws.send(JSON.stringify({
        type: 'identify',
        userId: profile.userId,
        username: profile.username,
        color: profile.color
    }));
    loadHistory(); // Load message history dari API
};
```

```typescript
// chat.ts - Handle identify message
case 'identify':
    session = {
        userId: data.userId || session.userId,
        username: data.username || 'Anonymous',
        color: data.color || '#3b82f6'
    };
    ws.serializeAttachment(session);
    
    // Notify others
    this.broadcast({
        type: 'join',
        userId: session.userId,
        username: session.username,
        color: session.color,
        content: `${session.username} joined the chat`,
        timestamp: Date.now()
    }, ws);
    
    // Send online users list to new user only
    this.sendOnlineUsersToClient(ws);
    break;
```

---

## 💬 Alur Pengiriman Pesan

### 4. Send Message Flow

> 💡 **Narasi:** Inilah inti dari fitur chat! Ketika kamu mengetik pesan dan menekan Enter, ada "trik" yang membuat pengalaman terasa sangat cepat. Browser langsung menampilkan pesanmu di layar **tanpa menunggu konfirmasi dari server** - ini disebut "Optimistic UI". Seperti ketika kamu menulis di papan tulis, tulisanmu langsung terlihat tanpa perlu minta izin guru dulu.
>
> Di sisi server, pesan kamu diterima, dicek (apakah spam?), lalu disebarkan ke semua teman lain. Server juga menyimpan pesan ke "buffer" dulu, baru nanti disimpan ke database secara berkala untuk efisiensi.

```
[Client A]                              [Durable Object]                    [Client B, C, ...]
    │                                          │                                    │
    │  {type: 'message', content: '...'}       │                                    │
    ├─────────────────────────────────────────►│                                    │
    │                                          │                                    │
    │  [Optimistic UI: Render sendiri]         │                                    │
    │                                          │                                    │
    │                                          │  Rate limit check                  │
    │                                          │  (max 30 msg/menit)                │
    │                                          │                                    │
    │                                          │  Broadcast ke semua                │
    │                                          │  KECUALI pengirim                  │
    │                                          ├───────────────────────────────────►│
    │                                          │                                    │
    │                                          │  Buffer ke messageBuffer           │
    │                                          │                                    │
    │                                          │  Schedule alarm untuk              │
    │                                          │  flush ke D1 (5 detik)             │
    │                                          │                                    │
```

**Apa yang terjadi step-by-step:**
1. **Kamu ketik pesan** dan tekan Enter
2. **Optimistic UI**: Browser langsung menampilkan pesanmu (tanpa tunggu server)
3. **Kirim ke server**: Pesan dikirim via WebSocket ke Durable Object
4. **Rate limit check**: Server mengecek apakah kamu spam (max 30 pesan/menit)
5. **Broadcast**: Server menyebarkan pesan ke SEMUA user KECUALI kamu (karena kamu sudah lihat di step 2)
6. **Buffer**: Pesan disimpan sementara di memory, belum ke database
7. **Schedule flush**: Server menjadwalkan penyimpanan ke database dalam 5 detik

**Kenapa tidak langsung simpan ke database?**
Karena database adalah operasi yang "mahal". Bayangkan jika 100 orang mengirim pesan bersamaan - akan ada 100 operasi database! Dengan buffering, kita mengumpulkan pesan dulu, lalu menyimpan sekaligus (batch insert). Lebih efisien!

**Kode Terkait:**

```javascript
// client.js - Kirim pesan
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: 'message',
        content: content
    }));

    // Optimistic UI - render langsung tanpa tunggu server
    renderMessage({
        type: 'message',
        userId: profile.userId,
        username: profile.username,
        color: profile.color,
        content: content,
        timestamp: Date.now()
    });

    messageInput.value = '';
}
```

```typescript
// chat.ts - Handle message
case 'message':
    if (!data.content?.trim()) return;

    // Rate limiting check
    const userRate = this.userMessageRates.get(session.userId);
    if (userRate.count > this.MAX_MESSAGES_PER_MINUTE) {
        return; // Skip jika melebihi limit
    }

    const chatMessage: ChatMessage = {
        type: 'message',
        userId: session.userId,
        username: session.username,
        color: session.color,
        content: data.content.trim(),
        timestamp: Date.now()
    };

    // Broadcast ke semua KECUALI pengirim
    this.broadcast(chatMessage, ws);

    // Buffer untuk batch insert ke D1
    this.messageBuffer.push(chatMessage);
    await this.ctx.storage.put('msg_buffer', this.messageBuffer);

    // Schedule flush via alarm
    if (!this.alarmScheduled) {
        this.alarmScheduled = true;
        await this.ctx.storage.setAlarm(Date.now() + 5000);
    }
    break;
```

---

## 💾 Alur Penyimpanan ke Database

### 5. Flush to D1 (Batch Insert)

> 💡 **Narasi:** Setelah mengumpulkan beberapa pesan di buffer, server akan menyimpan semuanya ke database sekaligus. Ini terjadi dalam dua kondisi: (1) sudah lewat 5 detik sejak pesan pertama, atau (2) buffer sudah penuh (10 pesan). Bayangkan guru yang mengumpulkan semua tugas dulu, baru dicatat semuanya di buku nilai - lebih efisien daripada bolak-balik mencatat satu per satu!
>
> Jika penyimpanan gagal (misalnya database sedang sibuk), server akan mencoba lagi dengan "exponential backoff" - tunggu 1 detik, lalu 2 detik, lalu 4 detik. Seperti mencoba menelepon yang sibuk, kamu menunggu makin lama sebelum mencoba lagi.

```
[Durable Object]                                          [D1 Database]
       │                                                        │
       │  Alarm triggered / Buffer >= 10                        │
       ├───────────────────────────────────────────────────────►│
       │                                                        │
       │  Batch INSERT messages                                 │
       │  (INSERT INTO messages ... VALUES ...)                 │
       ├───────────────────────────────────────────────────────►│
       │                                                        │
       │  Clear messageBuffer                                   │
       │◄───────────────────────────────────────────────────────┤
       │                                                        │
```

**Apa yang terjadi:**
1. **Alarm berbunyi** (5 detik berlalu) ATAU buffer sudah 10 pesan
2. **Ambil semua pesan** dari buffer
3. **Batch INSERT**: Kirim semua pesan ke database dalam satu operasi
4. **Kosongkan buffer** setelah berhasil
5. Jika gagal: simpan pesan kembali ke buffer dan jadwalkan retry

**Kode Terkait:**

```typescript
// chat.ts - Flush messages ke D1
private async flushToD1(retryCount = 0) {
    if (this.messageBuffer.length === 0 || this.isFlushing) return;

    this.isFlushing = true;
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];

    try {
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
    } catch (error) {
        // Retry dengan exponential backoff
        if (retryCount < this.MAX_RETRY_ATTEMPTS) {
            this.messageBuffer.unshift(...messages);
            const delay = Math.pow(2, retryCount) * 1000;
            await this.ctx.storage.setAlarm(Date.now() + delay);
        }
    }
    this.isFlushing = false;
}
```

---

## ⌨️ Alur Typing Indicator

### 6. Typing Indicator Flow

> 💡 **Narasi:** Pernah lihat "Ani sedang mengetik..." di WhatsApp? Nah, fitur ini bekerja serupa! Ketika kamu mulai mengetik, browser memberitahu server, lalu server memberitahu semua orang lain. Tapi, untuk mencegah spam notifikasi (bayangkan jika setiap huruf yang kamu ketik memicu notifikasi!), ada pembatasan: maksimal 1 notifikasi typing per 2 detik.
>
> Di room yang sangat ramai (lebih dari 100 orang), fitur ini dimatikan untuk menghemat bandwidth. Bayangkan jika 100 orang semua mengetik bersamaan - akan ada ribuan notifikasi per detik!

```
[Client A]                              [Durable Object]                    [Client B, C]
    │                                          │                                   │
    │  [User mulai mengetik]                   │                                   │
    │                                          │                                   │
    │  {type: 'typing'}                        │                                   │
    ├─────────────────────────────────────────►│                                   │
    │  (throttled: max 1x per 2 detik)         │                                   │
    │                                          │  Broadcast ke semua               │
    │                                          │  (skip jika room > 100 user)      │
    │                                          ├──────────────────────────────────►│
    │                                          │                                   │
    │  [User berhenti mengetik 3 detik]        │                                   │
    │                                          │                                   │
    │  {type: 'stop_typing'}                   │                                   │
    ├─────────────────────────────────────────►│                                   │
    │                                          ├──────────────────────────────────►│
    │                                          │                                   │
```

**Apa yang terjadi:**
1. **Kamu mulai mengetik**: Browser mengirim sinyal "typing"
2. **Throttle**: Browser hanya kirim sinyal maksimal 1x per 2 detik
3. **Broadcast**: Server menyebarkan ke semua user lain
4. **Berhenti mengetik**: Jika 3 detik tidak ada aktivitas, kirim "stop_typing"
5. **UI Update**: Browser orang lain menampilkan/menghilangkan indikator typing

---

## 📜 Alur Load History

### 7. Load Message History

> 💡 **Narasi:** Ketika kamu pertama kali membuka chat, kamu ingin melihat pesan-pesan sebelumnya kan? Nah, browser akan meminta "riwayat" dari server. Server mengambil 50 pesan terakhir dari database dan mengirimkannya. Ini terjadi terpisah dari WebSocket - menggunakan HTTP biasa karena ini adalah operasi satu kali saja, tidak perlu real-time.

```
[Client]                    [Worker]                    [D1 Database]
   │                           │                              │
   │  GET /api/messages        │                              │
   │  ?room=general&limit=50   │                              │
   ├──────────────────────────►│                              │
   │                           │  SELECT * FROM messages      │
   │                           │  WHERE room_id = ?           │
   │                           │  ORDER BY created_at DESC    │
   │                           │  LIMIT 50                    │
   │                           ├─────────────────────────────►│
   │                           │                              │
   │                           │  Return messages             │
   │                           │◄─────────────────────────────┤
   │  {messages: [...]}        │                              │
   │◄──────────────────────────┤                              │
   │                           │                              │
   │  [Render semua messages]  │                              │
   │                           │                              │
```

**Apa yang terjadi:**
1. **Request history**: Browser mengirim GET request ke `/api/messages`
2. **Query database**: Server mengambil 50 pesan terakhir dari room tersebut
3. **Return data**: Server mengembalikan array pesan dalam format JSON
4. **Render**: Browser menampilkan semua pesan di container chat
5. **Cache**: Response di-cache 30 detik untuk mengurangi beban database

---

## 🚪 Alur User Keluar

### 8. User Disconnect Flow

> 💡 **Narasi:** Ketika kamu menutup tab atau kehilangan koneksi internet, server mendeteksi bahwa WebSocket-mu terputus. Server kemudian memberitahu semua orang lain bahwa kamu sudah keluar, dan memastikan semua pesan yang belum tersimpan langsung di-flush ke database. Ini seperti ketika seseorang keluar dari grup - semua orang dapat notifikasi.

```
[Client]                                      [Durable Object]                    [Other Clients]
   │                                                 │                                   │
   │  [Close tab / disconnect]                       │                                   │
   │                                                 │                                   │
   │  WebSocket Close                                │                                   │
   ├────────────────────────────────────────────────►│                                   │
   │                                                 │                                   │
   │                                                 │  Broadcast 'leave'                │
   │                                                 ├──────────────────────────────────►│
   │                                                 │                                   │
   │                                                 │  Flush remaining                  │
   │                                                 │  messages to D1                   │
   │                                                 │                                   │
```

**Apa yang terjadi:**
1. **WebSocket Close**: Browser menutup atau koneksi terputus
2. **Detect disconnect**: Server mendeteksi koneksi tertutup
3. **Broadcast leave**: Server memberitahu semua user lain
4. **Flush buffer**: Jika ada pesan yang belum disimpan, langsung simpan ke database
5. **Cleanup**: Server membersihkan session attachment user tersebut

---

## 📊 Diagram Lengkap

```
                                    ┌─────────────────────────────────────┐
                                    │           CHAT FLOW DIAGRAM         │
                                    └─────────────────────────────────────┘

┌─────────────┐                     ┌─────────────────┐                    ┌─────────┐
│   CLIENT    │                     │ DURABLE OBJECT  │                    │   D1    │
│  (Browser)  │                     │   (ChatRoom)    │                    │ Database│
└──────┬──────┘                     └────────┬────────┘                    └────┬────┘
       │                                     │                                  │
       │ 1. WebSocket Connect                │                                  │
       ├────────────────────────────────────►│                                  │
       │                                     │                                  │
       │ 2. identify {userId, username}      │                                  │
       ├────────────────────────────────────►│                                  │
       │                                     │ Store session                    │
       │                                     │                                  │
       │ 3. online_users [...]               │                                  │
       │◄────────────────────────────────────┤                                  │
       │                                     │                                  │
       │ 4. GET /api/messages                │                                  │
       ├─────────────────────────────────────┼─────────────────────────────────►│
       │                                     │                                  │
       │ 5. Return history                   │                                  │
       │◄────────────────────────────────────┼──────────────────────────────────┤
       │                                     │                                  │
       │ 6. message {content: "..."}         │                                  │
       ├────────────────────────────────────►│                                  │
       │                                     │ Broadcast to others              │
       │                                     │ Buffer message                   │
       │                                     │                                  │
       │                                     │ 7. Alarm/Batch flush             │
       │                                     ├─────────────────────────────────►│
       │                                     │                                  │
       │ 8. typing                           │                                  │
       ├────────────────────────────────────►│                                  │
       │                                     │ Broadcast typing                 │
       │                                     │                                  │
       │ 9. WebSocket Close                  │                                  │
       ├────────────────────────────────────►│                                  │
       │                                     │ Broadcast leave                  │
       │                                     │ Flush remaining                  │
       │                                     ├─────────────────────────────────►│
       │                                     │                                  │
```

---

## 🔧 Optimisasi yang Diimplementasikan

> 💡 **Narasi:** Aplikasi chat yang baik harus cepat, hemat resource, dan aman. Berikut adalah berbagai teknik optimisasi yang diterapkan di sistem ini:

1. **Optimistic UI** - Pesan langsung ditampilkan tanpa tunggu server
   > *Seperti menulis di papan tulis - langsung terlihat tanpa perlu konfirmasi guru*

2. **Rate Limiting** - Max 30 pesan/menit per user
   > *Mencegah spam dan melindungi server dari user yang "terlalu aktif"*

3. **Batch Insert** - Pesan di-buffer dan di-flush setiap 5 detik atau saat buffer penuh
   > *Seperti mengumpulkan tugas sebelum dicatat di buku nilai - lebih efisien*

4. **Typing Throttle** - Max 1 typing broadcast per 2 detik
   > *Mencegah spam notifikasi typing setiap kali kamu menekan tombol*

5. **Large Room Skip** - Skip typing indicator untuk room > 100 user
   > *Di kelas yang sangat besar, fitur ini dimatikan untuk hemat bandwidth*

6. **WebSocket Hibernation** - Durable Object bisa hibernate untuk hemat resource
   > *Seperti mode sleep - jika tidak ada aktivitas, server "tidur" untuk hemat energi*

7. **Auto Reconnect** - Max 5 kali percobaan reconnect dengan delay 3 detik
   > *Jika koneksi terputus, browser otomatis mencoba menyambung ulang*

---

## 📁 File Terkait

| File | Deskripsi |
|------|-----------|
| `src/chat.ts` | Durable Object - Logic utama chat |
| `src/index.ts` | Hono router - API endpoints |
| `public/client.js` | Client-side JavaScript |
| `public/index.html` | UI halaman chat |
| `schema.sql` | Schema database D1 |
