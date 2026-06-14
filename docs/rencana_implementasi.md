# Rencana Implementasi Perbaikan Sistem 9-Ball Pool 2D

Dokumen ini memuat rencana kerja terstruktur per fase untuk memperbaiki dan meningkatkan kualitas game billiard Bola 9.

---

## Rincian Rencana Kerja per Fase

### 1. FASE 1: Core Physics & Game Rules (Fisika & Logika Meja)
*   **Overlap Check (Ball-in-Hand)**:
    *   Fungsi peletakan bola putih ([useGameEngine.ts](file:///c:/Capstone/TIM/billiard/frontend/src/hooks/useGameEngine.ts)) akan divalidasi.
    *   Jika posisi klik terlalu dekat dengan bola target lain (jarak $< 2 \times \text{BALL\_RADIUS}$), peletakan dibatalkan dan digambarkan lingkaran outline merah sebagai tanda terhalang.
*   **Fisik Cushion Miring (Trapezoid)**:
    *   Memperbarui Matter.js bodies dinding ban meja di [table.ts](file:///c:/Capstone/TIM/billiard/frontend/src/lib/physics/table.ts).
    *   Mengganti persegi panjang lurus biasa dengan poligon trapezoid miring agar pantulan fisik sinkron secara visual dengan sudut kemiringan meja.
*   **Aturan Break Sah (Break Shot Rules)**:
    *   Pukulan break pertama wajib memasukkan minimal 1 bola target ATAU minimal ada 4 bola target menyentuh cushion ban meja.
    *   Jika gagal, dianggap *Bad Break* (Foul) dan lawan mendapat *Ball-in-Hand*.

---

### 2. FASE 2: Controls & Aesthetics Enhancements (Aiming, SFX, HUD)
*   **Bidikan Mikro (Fine-tuning Angle)**:
    *   Menambahkan fungsi menangkap tombol keyboard Panah Kiri/Kanan untuk pergeseran sudut stik yang sangat kecil (presisi tinggi).
    *   Mendeteksi tombol `Shift` saat mouse digerakkan untuk memperlambat sensitivitas gerak bidik stik stik sebesar 90%.
*   **Efek Suara (Sound Effects)**:
    *   Membangun manager audio berbasis Web Audio API di frontend.
    *   Memainkan suara benturan stik dengan bola putih, benturan bola target dengan bola target (volume dinamis tergantung kecepatan tabrakan), pantulan ban, dan bola masuk lubang.
*   **Efek Transisi Turn**:
    *   Menampilkan pop-up animasi yang elegan "GILIRAN ANDA" atau "FOUL! BALL IN HAND" di tengah layar saat giliran berganti agar disadari pemain.

---

### 3. FASE 3: Multiplayer Stability & Quality of Life (Timer, Reconnection, Chat)
*   **Shot Clock (Turn Timer)**:
    *   Server membatasi waktu pukulan (misal 30 detik).
    *   Jika waktu habis tanpa tembakan, server memberikan pelanggaran waktu (*Time Foul*) dan memberikan giliran beserta *Ball-in-Hand* ke lawan.
*   **Masa Tenggang Disconnect (Reconnection Grace Period)**:
    *   Jika koneksi salah satu pemain mati sesaat (socket disconnect), server tidak langsung menghancurkan ruangan.
    *   Server memberikan waktu 20 detik bagi pemain untuk menyambung kembali dan melanjutkan permainan tanpa kehilangan progress.
*   **Quick Chat & Emoji**:
    *   Menyediakan menu mini berisi pesan cepat ("Nice Shot!", "Oops!", "GG!") dan emoji untuk berinteraksi di atas Player Badge.

---

## Rencana Pengujian (Verification Plan)

### Pengujian Manual
1.  **Overlap Check**: Tempatkan bola putih tepat di atas bola target lain saat *Ball-in-Hand*. Pastikan tidak bisa diletakkan dan muncul indikasi outline merah.
2.  **Break Rule**: Lakukan break sangat pelan. Pastikan server mendeteksi *Bad Break* dan memindahkan giliran ke musuh dengan status *Ball-in-Hand*.
3.  **Aiming Shift & Keyboard**: Tahan tombol `Shift` dan gerakkan mouse untuk memastikan pergerakan bidik stik melambat. Gunakan tombol panah keyboard untuk membidik dengan presisi tinggi.
4.  **Reconnection**: Putuskan jaringan (disconnect socket) selama 5-10 detik di tengah simulasi, lalu sambungkan kembali. Game harus pulih tanpa terpaksa kembali ke menu utama.
