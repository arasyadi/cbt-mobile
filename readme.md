# 📋 CBT Universitas — Tahap 3: Anti-Cheat + Timer Sync

## 🆕 Yang Ditambahkan di Tahap 3

### Backend (`Code.gs`)
| Fungsi Baru | Keterangan |
|-------------|-----------|
| `logPelanggaran()` | Rekam jenis pelanggaran + auto force-submit jika ≥5 |
| `syncTimer()` | Client minta sisa waktu dari server setiap 30 detik |
| `getStatusSesi()` | Ambil status lengkap sesi (pelanggaran, jawaban, timer) |
| Sheet "Pelanggaran" | Rekap semua pelanggaran per mahasiswa per sesi |

### Frontend (`index.html`)
| Fitur | Keterangan |
|-------|-----------|
| Anti-cheat 8 lapis | Tab switch, blur, copy, paste, klik kanan, PrintScreen, DevTools, fullscreen |
| 3 level overlay | Banner ringan → Overlay keras → Force-submit lock |
| Indikator 5 titik | Visual pelanggaran di header soal (kuning→merah) |
| Timer sync server | Koreksi drift setiap 30 detik dengan waktu server |
| Fullscreen otomatis | Request fullscreen saat mulai ujian, re-request jika keluar |
| Blur overlay | Layar diblur + dicatat saat app tidak aktif |
| Force-submit overlay | Layar terkunci permanen setelah ≥5 pelanggaran |

---

## ⚡ Cara Update dari Tahap 2

1. **Ganti `Code.gs`** → simpan
2. **Ganti `index.html`** (pastikan `API_URL` sudah diisi) → simpan
3. Jalankan `setupLengkap()` → sheet "Pelanggaran" akan dibuat otomatis
4. **Re-deploy** (Deploy → Manage deployments → Edit → Deploy)

---

## 📊 Sheet Baru: "Pelanggaran"

| Timestamp | NIM | SesiID | Jenis | Detail | NomorSoal |
|-----------|-----|--------|-------|--------|-----------|
| 2024-01-01 08:12 | 2021001 | SESI_... | TAB_SWITCH | Tab/app switch | 5 |
| 2024-01-01 08:15 | 2021001 | SESI_... | COPY_ATTEMPT | Copy | 7 |

**Baris berwarna merah** = pelanggaran berat (DEVTOOLS, MULTI_DEVICE)

---

## 🚦 9 Jenis Pelanggaran yang Terdeteksi

| Kode | Pemicu | Tampilkan Overlay? |
|------|--------|-------------------|
| `TAB_SWITCH` | Pindah tab / minimize | Blur overlay |
| `APP_BLUR` | Window kehilangan fokus (desktop) | Blur overlay |
| `COPY_ATTEMPT` | Ctrl+C / Ctrl+X | Banner ringan |
| `PASTE_ATTEMPT` | Ctrl+V | Banner ringan |
| `RIGHTCLICK` | Klik kanan mouse | Banner ringan |
| `SCREENSHOT_KEY` | Tombol Print Screen | Banner ringan |
| `DEVTOOLS` | F12 / Ctrl+Shift+I / ukuran window | Overlay keras |
| `FULLSCREEN_EXIT` | Keluar dari fullscreen | Banner + re-request |
| `force_cheat` | Mode submit otomatis dari server | Force lock |

---

## ⚙️ Konfigurasi (ubah di `Code.gs`)

```js
const MAX_PELANGGARAN    = 5;   // Setelah ini → force submit
const WARN_PELANGGARAN   = 3;   // Setelah ini → overlay keras
const TIMER_SYNC_INTERVAL = 30; // Sinkronisasi timer (detik)
```

Dan di `index.html` (harus sama):
```js
const MAX_PELANGGARAN  = 5;
const WARN_PELANGGARAN = 3;
const TIMER_SYNC_SEC   = 30;
```

---

## 🔒 Sistem 3-Level Overlay

```
Pelanggaran 1–2: Banner Kuning (bawah layar, auto-tutup 4 detik)
                     ↓
Pelanggaran 3–4: Overlay Merah PENUH (harus klik "Kembali ke Ujian")
                     ↓
Pelanggaran 5  : Force-Submit Lock (layar terkunci, tidak bisa ditutup)
                 Jawaban dikumpulkan otomatis
```

---

## 🔄 Alur Timer Sync

```
Client mulai ujian → Timer lokal berjalan
        ↓
  Setiap 30 detik → POST /syncTimer ke server
        ↓
  Server cek TanggalAkhir token → hitung sisa detik
        ↓
  Client restart timer dengan nilai dari server
  (mencegah mahasiswa manipulasi timer di browser)
```

---

## 📈 Yang Bisa Dosen Lihat di Spreadsheet

**Sheet "Pelanggaran"** — real-time saat ujian berlangsung:
- Kapan tepatnya mahasiswa pindah aplikasi
- Berapa kali mencoba copy soal
- Apakah membuka DevTools
- Nomor soal saat pelanggaran terjadi

**Sheet "Log"** — rekap aksi lengkap:
- `PELANGGARAN_TAB_SWITCH | Soal #3 | Total: 2`
- `SUBMIT_FORCE_CHEAT | Algoritma | Nilai:45 | Pelanggaran:5`

---

## 🔄 Tahap Berikutnya

| Tahap | Fitur | Status |
|-------|-------|--------|
| ✅ Tahap 1 | Login + Token | Selesai |
| ✅ Tahap 2 | Engine soal + Pengacakan | Selesai |
| ✅ Tahap 3 | Anti-Cheat + Timer Sync | **Selesai** |
| 🔜 Tahap 4 | Dashboard dosen (rekap nilai + pelanggaran) | Berikutnya |
