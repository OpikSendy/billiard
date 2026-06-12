# Product Requirement Document (PRD)
## Project: Web-Based 2D Multiplayer 9-Ball Pool Game

---

## 1. Overview & Objective
Project ini bertujuan untuk membangun game billiard Bola 9 (9-Ball Pool) berbasis web secara 2D yang dapat dimainkan bersama teman secara real-time via room link/code. Fokus utama adalah kesederhanaan akses (tanpa install), fisika 2D yang responsif, dan sinkronisasi turn-based yang akurat.

## 2. Target Tech Stack
*   **Frontend & Dashboard:** Next.js (React), Tailwind CSS
*   **Game Rendering:** HTML5 Canvas API (di-embed dalam komponen React)
*   **Physics Engine:** Matter.js (2D Physics)
*   **Realtime Communication:** Socket.io (Client)
*   **Backend Server:** Node.js + Express + Socket.io (Server terpisah untuk handle room & game state)

---

## 3. Core Features & Requirements

### 3.1. User & Lobby Management
*   **Guest Login:** User bisa langsung masuk hanya dengan memasukkan Nickname.
*   **Lobby / Room System:**
    *   Tombol "Create Room" -> Menghasilkan Room ID unik.
    *   Tombol "Join Room" -> User memasukkan Room ID untuk masuk ke room yang sama.
*   **Waiting Room:** Menampilkan daftar pemain yang terhubung (Maksimal 2 pemain per room). Game baru bisa dimulai jika kedua pemain sudah siap (Ready).

### 3.2. Game Mechanics & Physics (2D)
*   **Tampilan:** Top-down view (melihat meja dari atas secara penuh).
*   **Komponen Visual:** Meja billiard (dengan 6 lubang), 1 Bola Putih (Cue Ball), 9 Bola Target (bernomor 1 sampai 9), dan Stik Billiard (Cue Stick).
*   **Kontrol Stik:** 
    *   Mouse Bergerak -> Memutar arah stik mengelilingi bola putih (360 derajat).
    *   Mouse Drag/Power Meter -> Menentukan kekuatan pukulan.
    *   Spacebar / Klik -> Menembak.
*   **Fisika (Matter.js):**
    *   Pantulan bola ke ban meja (Cushion) harus elastis namun memiliki redaman.
    *   Gesekan meja (Friction) untuk memperlambat laju bola secara realistis hingga berhenti.
    *   Tabrakan antar bola (Ball-to-ball collision) yang akurat.

### 3.3. Aturan Game Bola 9 (9-Ball Rules Logic)
*   **Susunan Awal:** Bola disusun berbentuk berlian (Diamond) dengan bola nomor 1 di depan, dan bola nomor 9 tepat di tengah.
*   **Legal Hit:** Bola pertama yang harus disentuh oleh bola putih adalah bola dengan **angka terkecil** yang masih ada di meja.
*   **Foul (Pelanggaran):** 
    *   Bola putih tidak mengenai bola angka terkecil pertama kali.
    *   Bola putih masuk ke lubang (Scratch).
    *   Tidak ada bola yang menyentuh ban meja setelah tabrakan (opsional, untuk kompetitif).
    *   *Konsekuensi Foul:* Lawan mendapatkan "Ball in Hand" (bebas menaruh bola putih di mana saja).
*   **Kondisi Menang:** Pemain yang berhasil memasukkan **Bola 9** secara sah (legal hit sebelumnya) langsung memenangkan permainan.

### 3.4. Real-time Multiplayer Synchronization
*   **Turn-Based Flow:**
    1. Player 1 mengarahkan stik dan menembak.
    2. Input arah & kekuatan dikirim ke Socket.io Server.
    3. Server menyebarkan (broadcast) data tembakan ke Player 2.
    4. Kedua client menjalankan simulasi fisika lokal (Matter.js) secara bersamaan.
    5. Setelah semua bola BERHENTI TOTAL, kedua client mengirim koordinat akhir bola ke server untuk validasi sinkronisasi.
    6. Server menentukan giliran berikutnya berdasarkan hasil turn (apakah ada bola masuk, atau terjadi foul).

---

## 4. Development Phases (Milestones)

### Phase 1: Local Physics Prototype (Single Player)
*   Setup Next.js dengan HTML5 Canvas dan Matter.js.
*   Bikin border meja, lubang, dan memunculkan bola putih + bola target.
*   Implementasi kontrol stik dan mekanik pukulan.

### Phase 2: Game Logic & Rules
*   Implementasi logika urutan bola 1-9.
*   Deteksi bola masuk ke lubang (Pocketing system).
*   Sistem deteksi *foul* dan pergantian giliran secara lokal.

### Phase 3: Socket.io Backend & Lobby
*   Setup server Node.js terpisah untuk Socket.io.
*   Fitur Create/Join Room dan sinkronisasi status "Ready".

### Phase 4: Full Multiplayer Integration & Validation
*   Sinkronisasi tembakan antar player.
*   Validasi posisi akhir bola via server agar tidak desync.
*   UI/UX polesan (Turn indicator, papan skor, pop-up menang/kalah).