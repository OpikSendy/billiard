# Panduan Lengkap & Aturan Resmi Billiard Bola 9 (9-Ball Pool)

Dokumen ini berisi regulasi, mekanisme, dan logika permainan billiard Bola 9. Dokumentasi ini dapat digunakan sebagai acuan *game logic* dalam pengembangan sistem atau dipelajari sebagai panduan bermain.

---

## 1. Tujuan Permainan
Tujuan utama dari permainan Bola 9 adalah **memasukkan Bola 9 ke dalam lubang (pocket) secara sah**, baik di tengah permainan melalui kombinasi pukulan, maupun di akhir setelah bola nomor 1 sampai 8 sudah habis dimasukkan.

## 2. Peralatan & Susunan Bola (The Rack)
*   **Bola yang Digunakan:** 1 buah Bola Putih (Cue Ball) dan 9 buah Bola Target (bernomor 1 sampai 9).
*   **Susunan Awal (Diamond Rack):**
    *   Sembilan bola target disusun rapat membentuk wajik/berlian (Diamond).
    *   **Bola nomor 1** wajib diletakkan di paling depan (pada titik *Apex/Foot Spot*).
    *   **Bola nomor 9** wajib diletakkan tepat di tengah-tengah susunan.
    *   Sisa bola lainnya (nomor 2 sampai 8) ditempatkan secara acak di posisi sisa.

---

## 3. Alur Permainan

### 3.1. Pukulan Pembuka (The Break)
*   Bola putih ditempatkan di belakang garis *head string* (area *kitchen*).
*   Pemain yang melakukan *break* harus memukul bola putih dan mengenai **bola nomor 1** terlebih dahulu.
*   **Syarat Break Sah:** Minimal ada 1 bola target yang masuk ke lubang, ATAU minimal ada 4 bola target yang menyentuh ban meja (cushion). Jika tidak memenuhi syarat ini, maka dianggap pelanggaran (*illegal break*) dan lawan berhak menerima *Ball in Hand* atau meminta *re-rack* (susun ulang).

### 3.2. Urutan Pukulan (Rotasi)
*   Game ini menggunakan sistem rotasi. Pemain wajib mengarahkan bola putih untuk **menyentuh bola dengan angka terkecil** yang masih ada di atas meja terlebih dahulu.
*   *Contoh:* Jika di meja masih ada bola 2, 5, 7, dan 9, maka bola putih **harus** menabrak bola 2 dulu.

### 3.3. Pukulan Kombinasi (Combo Shot)
*   Pemain **tidak harus** memasukkan bola secara berurutan. 
*   Selama bola putih menabrak bola angka terkecil terlebih dahulu, lalu bola terkecil tersebut menabrak bola lain (misal bola 9) hingga masuk lubang, maka pukulan tersebut **SAH** dan pemain langsung memenangkan game (*Golden Shot/Combo Win*).

---

## 4. Aturan Pukulan Sah (Legal Hit)
Sebuah pukulan dinyatakan sah jika memenuhi dua syarat berikut:
1.  Bola putih menabrak bola dengan angka terendah di meja sebagai kontak pertama.
2.  Setelah tabrakan terjadi, minimal harus ada 1 bola yang masuk ke lubang **ATAU** minimal ada 1 bola (bola putih atau bola target mana pun) yang menyentuh ban meja (*cushion*).

> **Note:** Jika bola putih menabrak bola target tapi setelah itu tidak ada satu pun bola yang menyentuh ban atau masuk lubang, pukulan itu dianggap **Foul (Pelanggaran)**.

---

## 5. Jenis Pelanggaran (Fouls)
Jika seorang pemain melakukan pelanggaran, gilirannya langsung berhenti, dan pemain lawan mendapatkan keuntungan **Ball in Hand** (Bebas menaruh bola putih di posisi mana saja di atas meja untuk pukulan berikutnya).

Berikut adalah jenis-jenis pelanggaran dalam bola 9:
*   **Wrong Ball First:** Bola putih pertama kali menabrak bola yang bukan angka terkecil di meja.
*   **Scratch:** Bola putih masuk ke dalam lubang.
*   **No Cushion Hit:** Setelah bola putih menabrak bola target, tidak ada satu pun bola yang masuk lubang atau menyentuh ban meja.
*   **Bad Break:** Pukulan pembuka tidak memenuhi syarat minimal bola masuk atau 4 bola menyentuh ban.
*   **Ball Driven Off the Table:** Ada bola yang terpental keluar dari meja permainan. (Jika yang keluar bola target 1-8, bola dibiarkan hilang/dimasukkan kantong. Jika yang keluar bola 9, bola 9 wajib ditaruh kembali di titik *foot spot*).
*   **Double Hit / Touch:** Stik menyentuh bola putih lebih dari sekali, atau menyentuh bola target dengan tangan/pakaian.

---

## 6. Kondisi Kemenangan (Winning Conditions)
Seorang pemain dinyatakan memenangkan game jika:
1.  Memasukkan bola 9 secara sah pada saat giliran bermainnya (baik lewat kombinasi pukulan maupun pukulan langsung).
2.  **Aturan 3-Foul (Opsional/Kompetitif):** Jika lawan melakukan pelanggaran (*foul*) sebanyak 3 kali berturut-turut tanpa diselingi pukulan sah sekali pun. (Pemain harus diperingatkan saat sudah mencapai 2 foul).

---

## 7. Aturan Khusus: Push Out
Aturan ini hanya berlaku **tepat 1 pukulan setelah break**. Jika pemain yang melakukan break tidak melihat posisi bola yang bagus untuk ditembak secara sah:
*   Pemain boleh menyatakan *"Push Out"* sebelum memukul.
*   Pada pukulan *Push Out*, pemain bebas memukul bola putih ke mana saja tanpa harus mengenai bola angka terkecil dan tanpa harus menyentuh ban.
*   Setelah *Push Out* dilakukan, lawan memiliki 2 pilihan:
    1.  Mengambil giliran untuk menembak dari posisi bola saat itu.
    2.  Menolak giliran dan menyuruh pemain yang melakukan *Push Out* tadi untuk menembak kembali.