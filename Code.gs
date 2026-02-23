// ============================================================
//  CBT UNIVERSITAS - Apps Script Backend
//  Tahap 3: Anti-Cheat + Timer Sync + Log Pelanggaran
//
//  UPDATE: Ganti seluruh Code.gs, lalu re-deploy.
// ============================================================

const SPREADSHEET_ID    = "GANTI_DENGAN_ID_SPREADSHEET_ANDA";
const SHEET_MAHASISWA   = "Mahasiswa";
const SHEET_TOKEN       = "Token";
const SHEET_SOAL        = "Soal";
const SHEET_SESI        = "Sesi";
const SHEET_JAWABAN     = "Jawaban";
const SHEET_PELANGGARAN = "Pelanggaran";
const SHEET_LOG         = "Log";

// ── Konfigurasi Anti-Cheat ──────────────────
const MAX_PELANGGARAN    = 5;   // Setelah ini → force submit
const WARN_PELANGGARAN   = 3;   // Setelah ini → tampilkan peringatan keras
const TIMER_SYNC_INTERVAL = 30; // Sinkronisasi timer setiap N detik

// ─────────────────────────────────────────────
//  ROUTER
// ─────────────────────────────────────────────
function doGet(e) {
  if (e.parameter.manifest) return serveManifest();
  if (e.parameter.sw)       return serveServiceWorker();
  return HtmlService
    .createHtmlOutputFromFile("index")
    .setTitle("CBT Universitas")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, user-scalable=no");
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action } = payload;

    // Auth
    if (action === "login")          return respond(loginMahasiswa(payload));
    if (action === "verifyToken")    return respond(verifyToken(payload));
    if (action === "getSession")     return respond(getSession(payload));

    // Engine Soal
    if (action === "startUjian")     return respond(startUjian(payload));
    if (action === "saveJawaban")    return respond(saveJawaban(payload));
    if (action === "submitUjian")    return respond(submitUjian(payload));
    if (action === "getSesiAktif")   return respond(getSesiAktif(payload));

    // Tahap 3: Anti-Cheat
    if (action === "logPelanggaran") return respond(logPelanggaran(payload));
    if (action === "syncTimer")      return respond(syncTimer(payload));
    if (action === "getStatusSesi")  return respond(getStatusSesi(payload));

    return respond({ ok: false, message: "Aksi tidak dikenal." });
  } catch (err) {
    return respond({ ok: false, message: "Server error: " + err.message });
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════
//  TAHAP 1 & 2: AUTH + ENGINE (tidak berubah)
// ═══════════════════════════════════════════════

function loginMahasiswa({ nim, password }) {
  if (!nim || !password) return { ok: false, message: "NIM dan password wajib diisi." };
  const data = getSheet(SHEET_MAHASISWA).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const [rNim, rNama, rPass, rProdi, rStatus] = data[i];
    if (String(rNim).trim() === String(nim).trim()) {
      if (String(rPass).trim() !== String(password).trim()) {
        logAksi(nim, "LOGIN_GAGAL", "Password salah"); return { ok:false, message:"Password salah." };
      }
      if (String(rStatus).trim().toLowerCase() !== "aktif") return { ok:false, message:"Akun tidak aktif." };
      logAksi(nim, "LOGIN_BERHASIL", rNama);
      return { ok:true, nim:String(rNim).trim(), nama:String(rNama).trim(), prodi:String(rProdi).trim() };
    }
  }
  logAksi(nim, "LOGIN_GAGAL", "NIM tidak ditemukan");
  return { ok: false, message: "NIM tidak terdaftar." };
}

function verifyToken({ nim, token }) {
  if (!nim || !token) return { ok: false, message: "NIM dan token wajib diisi." };
  const data = getSheet(SHEET_TOKEN).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const [rToken, rMK, rDurasi, rMulai, rAkhir, rStatus] = data[i];
    if (String(rToken).trim().toUpperCase() === String(token).trim().toUpperCase()) {
      if (String(rStatus).trim().toLowerCase() !== "aktif") return { ok:false, message:"Token tidak aktif." };
      const now=new Date(), tM=new Date(rMulai), tA=new Date(rAkhir);
      if (now < tM) return { ok:false, message:"Ujian belum dimulai." };
      if (now > tA) return { ok:false, message:"Waktu ujian sudah berakhir." };
      const sisaDetik = Math.floor((tA - now) / 1000);
      logAksi(nim, "TOKEN_VALID", rMK);
      return { ok:true, mataKuliah:String(rMK).trim(), durasi:Number(rDurasi), sisaDetik, tokenId:String(rToken).trim().toUpperCase() };
    }
  }
  logAksi(nim, "TOKEN_INVALID", token);
  return { ok: false, message: "Token tidak ditemukan." };
}

function getSession({ nim, token }) { return verifyToken({ nim, token }); }

function startUjian({ nim, token }) {
  const check = verifyToken({ nim, token });
  if (!check.ok) return check;
  const { mataKuliah, durasi, sisaDetik, tokenId } = check;

  const sesiSheet = getSheet(SHEET_SESI);
  const sesiData  = sesiSheet.getDataRange().getValues();
  for (let i = 1; i < sesiData.length; i++) {
    const row = sesiData[i];
    if (String(row[1]).trim()===String(nim).trim() &&
        String(row[2]).trim().toUpperCase()===tokenId &&
        String(row[5]).trim().toLowerCase()==="aktif") {
      const urutanSoal = JSON.parse(row[6]);
      const soalList   = getSoalByIds(urutanSoal, mataKuliah);
      const jawabanMap = getJawabanMahasiswa(nim, row[0]);
      const jmlPelanggaran = getPelanggaranCount(nim, row[0]);
      logAksi(nim, "UJIAN_RESUME", mataKuliah);
      return { ok:true, resume:true, sesiId:row[0], mataKuliah, durasi, sisaDetik,
               soal:soalList, jawaban:jawabanMap, jumlahSoal:soalList.length,
               pelanggaranCount:jmlPelanggaran, maxPelanggaran:MAX_PELANGGARAN };
    }
  }

  const semuaSoal = getSoalByMataKuliah(mataKuliah);
  if (semuaSoal.length === 0) return { ok:false, message:"Bank soal belum tersedia." };

  const seed      = nim + tokenId;
  const soalAcak  = shuffleWithSeed(semuaSoal, seed);
  const soalFinal = soalAcak.map(s => ({
    id: s.id, pertanyaan: s.pertanyaan, tingkat: s.tingkat,
    opsi: shuffleWithSeed(s.opsi, seed + s.id)
  }));

  const urutanIds  = soalFinal.map(s => s.id);
  const sesiId     = "SESI_" + nim + "_" + tokenId;
  sesiSheet.appendRow([sesiId, nim, tokenId, mataKuliah, new Date(), "aktif", JSON.stringify(urutanIds), soalFinal.length, ""]);

  logAksi(nim, "UJIAN_MULAI", mataKuliah + " | " + soalFinal.length + " soal");
  return { ok:true, resume:false, sesiId, mataKuliah, durasi, sisaDetik,
           soal:soalFinal, jawaban:{}, jumlahSoal:soalFinal.length,
           pelanggaranCount:0, maxPelanggaran:MAX_PELANGGARAN };
}

function saveJawaban({ nim, sesiId, soalId, jawaban }) {
  if (!nim || !sesiId || !soalId) return { ok:false, message:"Data tidak lengkap." };
  const sheet = getSheet(SHEET_JAWABAN);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim()===String(nim).trim() &&
        String(data[i][1]).trim()===String(sesiId).trim() &&
        String(data[i][2]).trim()===String(soalId).trim()) {
      sheet.getRange(i+1,4).setValue(jawaban);
      sheet.getRange(i+1,5).setValue(new Date());
      return { ok:true };
    }
  }
  sheet.appendRow([nim, sesiId, soalId, jawaban, new Date()]);
  return { ok:true };
}

function submitUjian({ nim, sesiId, token, mode }) {
  if (!nim || !sesiId) return { ok:false, message:"Data tidak lengkap." };
  const sesiSheet = getSheet(SHEET_SESI);
  const sesiData  = sesiSheet.getDataRange().getValues();
  let sesiRow=-1, jumlahSoal=0, mataKuliah="", urutanIds=[];
  for (let i=1; i<sesiData.length; i++) {
    if (String(sesiData[i][0]).trim()===String(sesiId).trim() &&
        String(sesiData[i][1]).trim()===String(nim).trim()) {
      sesiRow=i+1; mataKuliah=sesiData[i][3];
      jumlahSoal=Number(sesiData[i][7]); urutanIds=JSON.parse(sesiData[i][6]); break;
    }
  }
  if (sesiRow < 0) return { ok:false, message:"Sesi tidak ditemukan." };

  sesiSheet.getRange(sesiRow, 6).setValue("selesai_" + (mode||"manual"));
  sesiSheet.getRange(sesiRow, 9).setValue(new Date());

  const hasil = hitungNilai(nim, sesiId, urutanIds, mataKuliah);
  const jmlPelanggaran = getPelanggaranCount(nim, sesiId);

  logAksi(nim, "SUBMIT_"+(mode||"manual").toUpperCase(),
    mataKuliah+" | Nilai:"+hasil.nilai+" | Pelanggaran:"+jmlPelanggaran);

  return { ok:true, nilai:hasil.nilai, benar:hasil.benar, salah:hasil.salah,
           kosong:hasil.kosong, jumlahSoal, mataKuliah, mode:mode||"manual",
           pelanggaranCount:jmlPelanggaran };
}

function getSesiAktif({ nim, token }) {
  const tokenRes = verifyToken({ nim, token });
  if (!tokenRes.ok) return { ok:false, sesiAda:false };
  const sesiData = getSheet(SHEET_SESI).getDataRange().getValues();
  for (let i=1; i<sesiData.length; i++) {
    if (String(sesiData[i][1]).trim()===String(nim).trim() &&
        String(sesiData[i][2]).trim().toUpperCase()===tokenRes.tokenId &&
        String(sesiData[i][5]).trim().toLowerCase()==="aktif") {
      return { ok:true, sesiAda:true, sesiId:sesiData[i][0] };
    }
  }
  return { ok:true, sesiAda:false };
}

// ═══════════════════════════════════════════════
//  TAHAP 3: ANTI-CHEAT
// ═══════════════════════════════════════════════

/**
 * logPelanggaran
 * Payload: { action, nim, sesiId, jenis, detail, nomorSoal }
 *
 * Jenis pelanggaran yang ditangani:
 * - TAB_SWITCH    : Pindah tab / minimize browser
 * - APP_BLUR      : Aplikasi kehilangan fokus
 * - COPY_ATTEMPT  : Mencoba copy teks soal
 * - PASTE_ATTEMPT : Mencoba paste
 * - RIGHTCLICK    : Klik kanan
 * - DEVTOOLS      : Developer tools terbuka
 * - SCREENSHOT_KEY: Tombol Print Screen ditekan
 * - FULLSCREEN_EXIT: Keluar dari fullscreen
 * - MULTI_DEVICE  : Login di perangkat lain (future)
 *
 * Return:
 * - pelanggaranCount: total pelanggaran sesi ini
 * - forceSubmit: true jika melebihi MAX_PELANGGARAN
 * - peringatan: true jika mencapai WARN_PELANGGARAN
 */
function logPelanggaran({ nim, sesiId, jenis, detail, nomorSoal }) {
  if (!nim || !sesiId || !jenis)
    return { ok:false, message:"Data tidak lengkap." };

  // Simpan ke sheet Pelanggaran
  const sheet = getSheet(SHEET_PELANGGARAN);
  sheet.appendRow([
    new Date(),
    String(nim),
    String(sesiId),
    String(jenis),
    String(detail || ""),
    Number(nomorSoal || 0)
  ]);

  const count = getPelanggaranCount(nim, sesiId);

  // Warna highlight di sheet jika berbahaya
  if (jenis === "DEVTOOLS" || jenis === "MULTI_DEVICE") {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 6).setBackground("#ffcccc");
  }

  logAksi(nim, "PELANGGARAN_" + jenis, "Soal #" + (nomorSoal||"?") + " | Total: " + count);

  // Cek apakah harus force submit
  if (count >= MAX_PELANGGARAN) {
    // Auto-submit dari server side
    submitUjian({ nim, sesiId, token: null, mode: "force_cheat" });
    return {
      ok: true,
      pelanggaranCount: count,
      forceSubmit: true,
      message: "Terlalu banyak pelanggaran. Ujian dikumpulkan paksa."
    };
  }

  return {
    ok: true,
    pelanggaranCount: count,
    forceSubmit: false,
    peringatan: count >= WARN_PELANGGARAN,
    sisaKesempatan: MAX_PELANGGARAN - count,
    message: "Pelanggaran tercatat."
  };
}

/**
 * syncTimer
 * Client memanggil ini setiap TIMER_SYNC_INTERVAL detik
 * untuk sinkronisasi waktu server
 * Payload: { action, nim, token }
 */
function syncTimer({ nim, token }) {
  if (!nim || !token) return { ok:false };

  // Ambil sisa waktu dari token
  const sheet = getSheet(SHEET_TOKEN);
  const data  = sheet.getDataRange().getValues();
  for (let i=1; i<data.length; i++) {
    const [rToken,,, rMulai, rAkhir, rStatus] = data[i];
    // Cari berdasarkan NIM yang punya token aktif
    if (String(rToken).trim().toUpperCase() === String(token).trim().toUpperCase()) {
      if (String(rStatus).trim().toLowerCase() !== "aktif") return { ok:false, expired:true };
      const now = new Date(), tAkhir = new Date(rAkhir);
      if (now > tAkhir) return { ok:true, sisaDetik:0, expired:true };
      return { ok:true, sisaDetik: Math.floor((tAkhir-now)/1000), expired:false };
    }
  }
  return { ok:false };
}

/**
 * getStatusSesi
 * Ambil status lengkap sesi: pelanggaran, jawaban terisi, sisa waktu
 * Payload: { action, nim, sesiId, token }
 */
function getStatusSesi({ nim, sesiId, token }) {
  if (!nim || !sesiId) return { ok:false };

  const count      = getPelanggaranCount(nim, sesiId);
  const jawabanMap = getJawabanMahasiswa(nim, sesiId);
  const timerRes   = token ? syncTimer({ nim, token }) : { ok:false };

  return {
    ok: true,
    pelanggaranCount: count,
    jawabanTerisi:    Object.keys(jawabanMap).length,
    sisaDetik:        timerRes.ok ? timerRes.sisaDetik : null,
    forceSubmit:      count >= MAX_PELANGGARAN
  };
}

// ─────────────────────────────────────────────
//  HELPERS SOAL & NILAI
// ─────────────────────────────────────────────
function getSoalByMataKuliah(mataKuliah) {
  const data = getSheet(SHEET_SOAL).getDataRange().getValues();
  const soal = [];
  for (let i=1; i<data.length; i++) {
    const [id, mk, pertanyaan, a, b, c, d, kunci, tingkat] = data[i];
    if (String(mk).trim().toLowerCase() === String(mataKuliah).trim().toLowerCase()) {
      soal.push({
        id: String(id).trim(), pertanyaan: String(pertanyaan).trim(),
        opsi: [
          { kode:"A", teks:String(a||"").trim() }, { kode:"B", teks:String(b||"").trim() },
          { kode:"C", teks:String(c||"").trim() }, { kode:"D", teks:String(d||"").trim() },
        ].filter(o => o.teks),
        kunci: String(kunci).trim().toUpperCase(),
        tingkat: String(tingkat||"sedang").trim()
      });
    }
  }
  return soal;
}

function getSoalByIds(ids, mataKuliah) {
  const map = {};
  getSoalByMataKuliah(mataKuliah).forEach(s => {
    map[s.id] = { id:s.id, pertanyaan:s.pertanyaan, opsi:s.opsi, tingkat:s.tingkat };
  });
  return ids.map(id => map[id]).filter(Boolean);
}

function getJawabanMahasiswa(nim, sesiId) {
  const data = getSheet(SHEET_JAWABAN).getDataRange().getValues();
  const map  = {};
  for (let i=1; i<data.length; i++) {
    if (String(data[i][0]).trim()===String(nim).trim() &&
        String(data[i][1]).trim()===String(sesiId).trim())
      map[String(data[i][2]).trim()] = String(data[i][3]).trim();
  }
  return map;
}

function hitungNilai(nim, sesiId, urutanIds, mataKuliah) {
  const jMap = getJawabanMahasiswa(nim, sesiId);
  const kMap = {};
  getSoalByMataKuliah(mataKuliah).forEach(s => kMap[s.id] = s.kunci);
  let benar=0, salah=0, kosong=0;
  urutanIds.forEach(id => {
    const j=jMap[id], k=kMap[id];
    if (!j) { kosong++; return; }
    j.toUpperCase()===k ? benar++ : salah++;
  });
  return { nilai: urutanIds.length > 0 ? Math.round((benar/urutanIds.length)*100) : 0, benar, salah, kosong };
}

/**
 * Hitung total pelanggaran sesi ini
 */
function getPelanggaranCount(nim, sesiId) {
  try {
    const data = getSheet(SHEET_PELANGGARAN).getDataRange().getValues();
    let count  = 0;
    for (let i=1; i<data.length; i++) {
      if (String(data[i][1]).trim()===String(nim).trim() &&
          String(data[i][2]).trim()===String(sesiId).trim()) count++;
    }
    return count;
  } catch(e) { return 0; }
}

// ─────────────────────────────────────────────
//  Fisher-Yates deterministik
// ─────────────────────────────────────────────
function shuffleWithSeed(arr, seed) {
  const a = [...arr]; let s = hashSeed(String(seed));
  const rand = () => { s=(s*1664525+1013904223)&0xffffffff; return (s>>>0)/0x100000000; };
  for (let i=a.length-1; i>0; i--) { const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function hashSeed(str) {
  let h=5381;
  for (let i=0; i<str.length; i++) h=((h<<5)+h)^str.charCodeAt(i);
  return h>>>0;
}

// ─────────────────────────────────────────────
//  LOGGING & SHEET HELPER
// ─────────────────────────────────────────────
function logAksi(nim, aksi, detail) {
  try { getSheet(SHEET_LOG).appendRow([new Date(), String(nim), String(aksi), String(detail)]); } catch(e) {}
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = {
      [SHEET_MAHASISWA]:   ["NIM","Nama","Password","Prodi","Status"],
      [SHEET_TOKEN]:       ["Token","MataKuliah","Durasi(menit)","TanggalMulai","TanggalAkhir","Status"],
      [SHEET_SOAL]:        ["ID","MataKuliah","Pertanyaan","OpsiA","OpsiB","OpsiC","OpsiD","KunciJawaban","Tingkat"],
      [SHEET_SESI]:        ["SesiID","NIM","Token","MataKuliah","WaktuMulai","Status","UrutanSoal","JumlahSoal","WaktuSelesai"],
      [SHEET_JAWABAN]:     ["NIM","SesiID","SoalID","Jawaban","Timestamp"],
      [SHEET_PELANGGARAN]: ["Timestamp","NIM","SesiID","Jenis","Detail","NomorSoal"],
      [SHEET_LOG]:         ["Timestamp","NIM","Aksi","Detail"],
    };
    if (headers[name]) sheet.appendRow(headers[name]);
  }
  return sheet;
}

// ─────────────────────────────────────────────
//  PWA
// ─────────────────────────────────────────────
function serveManifest() {
  return ContentService.createTextOutput(JSON.stringify({
    name:"CBT Universitas", short_name:"CBT", start_url:"./", display:"standalone",
    background_color:"#0f172a", theme_color:"#3b82f6", orientation:"portrait",
    icons:[
      { src:"https://placehold.co/192x192/3b82f6/ffffff?text=CBT", sizes:"192x192", type:"image/png" },
      { src:"https://placehold.co/512x512/3b82f6/ffffff?text=CBT", sizes:"512x512", type:"image/png" }
    ]
  })).setMimeType(ContentService.MimeType.JSON);
}
function serveServiceWorker() {
  return ContentService.createTextOutput(`
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', e => e.waitUntil(clients.claim()));
    self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));
  `).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ═══════════════════════════════════════════════
//  SETUP — Jalankan setupLengkap() sekali saja
// ═══════════════════════════════════════════════
function setupLengkap() {
  const sheetM = getSheet(SHEET_MAHASISWA);
  if (sheetM.getLastRow() <= 1) {
    sheetM.appendRow(["2021001","Budi Santoso","budi123","Teknik Informatika","aktif"]);
    sheetM.appendRow(["2021002","Siti Rahayu","siti123","Teknik Informatika","aktif"]);
    sheetM.appendRow(["2021003","Ahmad Fauzi","ahmad123","Sistem Informasi","aktif"]);
  }
  const sheetT = getSheet(SHEET_TOKEN);
  if (sheetT.getLastRow() <= 1) {
    const now=new Date(), akhir=new Date(now.getTime()+24*60*60*1000);
    sheetT.appendRow(["UJIAN2024","Pemrograman Web",90,now,akhir,"aktif"]);
    sheetT.appendRow(["ALGO2024","Algoritma",60,now,akhir,"aktif"]);
  }
  const sheetS = getSheet(SHEET_SOAL);
  if (sheetS.getLastRow() <= 1) {
    [
      ["PW001","Pemrograman Web","Tag HTML untuk hyperlink adalah...","<a>","<link>","<href>","<url>","A","mudah"],
      ["PW002","Pemrograman Web","CSS adalah singkatan dari...","Cascading Style Sheets","Creative Style Sheets","Computer Style Sheets","Colorful Style Sheets","A","mudah"],
      ["PW003","Pemrograman Web","Properti CSS untuk warna teks...","color","font-color","text-color","foreground","A","mudah"],
      ["PW004","Pemrograman Web","Selektor ID dalam CSS adalah...","#header",".header","+header","*header","A","mudah"],
      ["PW005","Pemrograman Web","Metode HTTP untuk kirim data form aman...","POST","GET","PUT","HEAD","A","sedang"],
      ["PW006","Pemrograman Web","Fungsi JS pilih elemen by ID...","getElementById()","getElement()","findById()","selectId()","A","sedang"],
      ["PW007","Pemrograman Web","Output console.log(typeof null)...","object","null","undefined","string","A","sedang"],
      ["PW008","Pemrograman Web","Yang BUKAN tipe input HTML5...","<input type='color'>","<input type='date'>","<input type='phone'>","<input type='range'>","C","sedang"],
      ["PW009","Pemrograman Web","Box model CSS urutan luar ke dalam...","Margin-Border-Padding-Content","Border-Margin-Padding-Content","Padding-Border-Margin-Content","Content-Padding-Border-Margin","A","sulit"],
      ["PW010","Pemrograman Web","Event saat DOM selesai dimuat...","DOMContentLoaded","onload","DOMReady","pageshow","A","sulit"],
      ["AL001","Algoritma","Kompleksitas Binary Search terbaik...","O(1)","O(n)","O(log n)","O(n²)","A","sedang"],
      ["AL002","Algoritma","Struktur data LIFO adalah...","Stack","Queue","Tree","Graph","A","mudah"],
      ["AL003","Algoritma","Sorting dengan O(n log n) rata-rata...","Quick Sort","Bubble Sort","Insertion Sort","Selection Sort","A","sedang"],
      ["AL004","Algoritma","Rekursi wajib memiliki...","Base case dan recursive case","Hanya recursive case","Hanya base case","Loop dan kondisi","A","mudah"],
      ["AL005","Algoritma","Big-O nested loop array ukuran n...","O(n²)","O(n)","O(2n)","O(log n)","A","sedang"],
    ].forEach(r => sheetS.appendRow(r));
  }
  getSheet(SHEET_SESI); getSheet(SHEET_JAWABAN);
  getSheet(SHEET_PELANGGARAN); getSheet(SHEET_LOG);
  Logger.log("Setup Tahap 3 selesai! Sheet Pelanggaran sudah dibuat.");
}
