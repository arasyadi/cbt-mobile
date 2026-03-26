// ============================================================
//  CBT UNIVERSITAS - Apps Script Backend
//  Tahap 4: Dashboard Dosen (Monitor + Rekap + Statistik)
//
//  UPDATE: Ganti seluruh Code.gs, lalu re-deploy.
// ============================================================

const SPREADSHEET_ID    = "1BH128K3HKqogvCzjyaq41E-8KioM2qbKgzJKD4gXuRE";
const SHEET_MAHASISWA   = "Mahasiswa";
const SHEET_TOKEN       = "Token";
const SHEET_SOAL        = "Soal";
const SHEET_SESI        = "Sesi";
const SHEET_JAWABAN     = "Jawaban";
const SHEET_PELANGGARAN = "Pelanggaran";
const SHEET_DOSEN       = "Dosen";
const SHEET_LOG         = "Log";

const MAX_PELANGGARAN    = 5;
const WARN_PELANGGARAN   = 3;
const TIMER_SYNC_INTERVAL = 30;

// ─────────────────────────────────────────────
//  ROUTER UTAMA
// ─────────────────────────────────────────────
function doGet(e) {
  if (e.parameter.manifest)  return serveManifest();
  if (e.parameter.sw)        return serveServiceWorker();
  if (e.parameter.dashboard) return serveDashboard();
  return HtmlService
    .createHtmlOutputFromFile("index")
    .setTitle("CBT Universitas")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, user-scalable=no");
}

function serveDashboard() {
  return HtmlService
    .createHtmlOutputFromFile("dashboard")
    .setTitle("Dashboard Dosen — CBT Universitas")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0");
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action } = payload;

    // ── Auth Mahasiswa ──
    if (action === "login")           return respond(loginMahasiswa(payload));
    if (action === "verifyToken")     return respond(verifyToken(payload));
    if (action === "getSession")      return respond(getSession(payload));

    // ── Engine Soal ──
    if (action === "startUjian")      return respond(startUjian(payload));
    if (action === "saveJawaban")     return respond(saveJawaban(payload));
    if (action === "submitUjian")     return respond(submitUjian(payload));
    if (action === "getSesiAktif")    return respond(getSesiAktif(payload));

    // ── Anti-Cheat ──
    if (action === "logPelanggaran")  return respond(logPelanggaran(payload));
    if (action === "syncTimer")       return respond(syncTimer(payload));
    if (action === "getStatusSesi")   return respond(getStatusSesi(payload));

    // ── Dashboard Dosen (Tahap 4) ──
    if (action === "loginDosen")      return respond(loginDosen(payload));
    if (action === "getMonitorAktif") return respond(getMonitorAktif(payload));
    if (action === "getRekapNilai")   return respond(getRekapNilai(payload));
    if (action === "getRekapPelanggaran") return respond(getRekapPelanggaran(payload));
    if (action === "getDashboardStats")   return respond(getDashboardStats(payload));
    if (action === "forceSubmitMahasiswa")return respond(forceSubmitMahasiswaDosen(payload));
    if (action === "resetSesiMahasiswa")  return respond(resetSesiMahasiswa(payload));
    if (action === "getTokenList")        return respond(getTokenList(payload));
    if (action === "buatToken")           return respond(buatToken(payload));
    if (action === "nonaktifkanToken")    return respond(nonaktifkanToken(payload));

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

// ═══════════════════════════════════════════════════════════
//  TAHAP 1–3: AUTH + ENGINE + ANTI-CHEAT (tidak berubah)
// ═══════════════════════════════════════════════════════════

function loginMahasiswa({ nim, password }) {
  if (!nim || !password) return { ok:false, message:"NIM dan password wajib diisi." };
  const data = getSheet(SHEET_MAHASISWA).getDataRange().getValues();
  for (let i=1; i<data.length; i++) {
    const [rNim,rNama,rPass,rProdi,rStatus] = data[i];
    if (String(rNim).trim()===String(nim).trim()) {
      if (String(rPass).trim()!==String(password).trim()) { logAksi(nim,"LOGIN_GAGAL","Password salah"); return {ok:false,message:"Password salah."}; }
      if (String(rStatus).trim().toLowerCase()!=="aktif") return {ok:false,message:"Akun tidak aktif."};
      logAksi(nim,"LOGIN_BERHASIL",rNama);
      return {ok:true,nim:String(rNim).trim(),nama:String(rNama).trim(),prodi:String(rProdi).trim()};
    }
  }
  logAksi(nim,"LOGIN_GAGAL","NIM tidak ditemukan");
  return {ok:false,message:"NIM tidak terdaftar."};
}

function verifyToken({ nim, token }) {
  if (!nim||!token) return {ok:false,message:"NIM dan token wajib diisi."};
  const data = getSheet(SHEET_TOKEN).getDataRange().getValues();
  for (let i=1; i<data.length; i++) {
    const [rToken,rMK,rDurasi,rMulai,rAkhir,rStatus] = data[i];
    if (String(rToken).trim().toUpperCase()===String(token).trim().toUpperCase()) {
      if (String(rStatus).trim().toLowerCase()!=="aktif") return {ok:false,message:"Token tidak aktif."};
      const now=new Date(),tM=new Date(rMulai),tA=new Date(rAkhir);
      if (now<tM) return {ok:false,message:"Ujian belum dimulai."};
      if (now>tA) return {ok:false,message:"Waktu ujian sudah berakhir."};
      const sisaDetik=Math.floor((tA-now)/1000);
      logAksi(nim,"TOKEN_VALID",rMK);
      return {ok:true,mataKuliah:String(rMK).trim(),durasi:Number(rDurasi),sisaDetik,tokenId:String(rToken).trim().toUpperCase()};
    }
  }
  logAksi(nim,"TOKEN_INVALID",token);
  return {ok:false,message:"Token tidak ditemukan."};
}
function getSession({nim,token}){return verifyToken({nim,token});}

function startUjian({ nim, token }) {
  const check = verifyToken({nim,token});
  if (!check.ok) return check;

  const {mataKuliah, durasi, tokenId} = check;
  const durasiDetik = durasi * 60;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Antrean maks 10 detik — aman untuk 40 mahasiswa bersamaan

    const sesiSheet = getSheet(SHEET_SESI);
    const sesiData  = sesiSheet.getDataRange().getValues();

    for (let i=1; i<sesiData.length; i++) {
      const row = sesiData[i];
      if (String(row[1]).trim()===String(nim).trim() &&
          String(row[2]).trim().toUpperCase()===tokenId &&
          String(row[5]).trim().toLowerCase()==="aktif") {

        // Hitung sisa waktu berdasarkan waktu MULAI sesi, bukan dari token
        // Ini mencegah "bonus waktu" saat resume setelah koneksi putus
        const waktuMulai    = new Date(row[4]);
        const berjalanDetik = Math.floor((new Date() - waktuMulai) / 1000);
        let sisaDetikUjian  = durasiDetik - berjalanDetik;
        if (sisaDetikUjian < 0) sisaDetikUjian = 0;

        const soalList       = getSoalByIds(JSON.parse(row[6]), mataKuliah);
        const jawabanMap     = getJawabanMahasiswa(nim, row[0]);
        const jmlPelanggaran = getPelanggaranCount(nim, row[0]);
        logAksi(nim, "UJIAN_RESUME", mataKuliah);
        return {ok:true, resume:true, sesiId:row[0], mataKuliah, durasi,
                sisaDetik:sisaDetikUjian, soal:soalList, jawaban:jawabanMap,
                jumlahSoal:soalList.length, pelanggaranCount:jmlPelanggaran,
                maxPelanggaran:MAX_PELANGGARAN};
      }
    }

    // Sesi baru
    const semuaSoal = getSoalByMataKuliah(mataKuliah);
    if (semuaSoal.length===0) return {ok:false, message:"Bank soal belum tersedia."};

    const seed      = nim + tokenId;
    const soalFinal = shuffleWithSeed(semuaSoal, seed).map(s => ({
      id:s.id, pertanyaan:s.pertanyaan, tingkat:s.tingkat,
      opsi: shuffleWithSeed(s.opsi, seed + s.id)
    }));
    const urutanIds = soalFinal.map(s => s.id);
    const sesiId    = "SESI_" + nim + "_" + tokenId;

    sesiSheet.appendRow([sesiId, nim, tokenId, mataKuliah, new Date(), "aktif",
                         JSON.stringify(urutanIds), soalFinal.length, ""]);
    logAksi(nim, "UJIAN_MULAI", mataKuliah + " | " + soalFinal.length + " soal");
    return {ok:true, resume:false, sesiId, mataKuliah, durasi,
            sisaDetik:durasiDetik, soal:soalFinal, jawaban:{},
            jumlahSoal:soalFinal.length, pelanggaranCount:0,
            maxPelanggaran:MAX_PELANGGARAN};

  } catch(e) {
    return {ok:false, message:"Server sedang sibuk mengatur sesi ujian, silakan coba lagi."};
  } finally {
    lock.releaseLock();
  }
}

function saveJawaban({ nim, sesiId, soalId, jawaban }) {
  if (!nim||!sesiId||!soalId) return {ok:false, message:"Data tidak lengkap."};

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Cegah race condition saat 40 mahasiswa save bersamaan

    const sheet = getSheet(SHEET_JAWABAN);
    const data  = sheet.getDataRange().getValues();
    for (let i=1; i<data.length; i++) {
      if (String(data[i][0]).trim()===String(nim).trim() &&
          String(data[i][1]).trim()===String(sesiId).trim() &&
          String(data[i][2]).trim()===String(soalId).trim()) {
        sheet.getRange(i+1, 4).setValue(jawaban);
        sheet.getRange(i+1, 5).setValue(new Date());
        return {ok:true};
      }
    }
    sheet.appendRow([nim, sesiId, soalId, jawaban, new Date()]);
    return {ok:true};

  } catch(e) {
    return {ok:false, message:"Server sedang sibuk, jawaban akan disinkronkan otomatis."};
  } finally {
    lock.releaseLock();
  }
}

function submitUjian({ nim, sesiId, token, mode }) {
  if (!nim||!sesiId) return {ok:false, message:"Data tidak lengkap."};

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

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
    if (sesiRow<0) return {ok:false, message:"Sesi tidak ditemukan."};

    // Cegah double-submit: jika sudah selesai, kembalikan hasil yang ada
    if (String(sesiData[sesiRow-1][5]).toLowerCase().startsWith("selesai")) {
      const hasil = hitungNilai(nim, sesiId, urutanIds, mataKuliah);
      return {ok:true, nilai:hasil.nilai, benar:hasil.benar, salah:hasil.salah,
              kosong:hasil.kosong, jumlahSoal, mataKuliah,
              mode: String(sesiData[sesiRow-1][5]).replace("selesai_",""),
              pelanggaranCount: getPelanggaranCount(nim, sesiId)};
    }

    sesiSheet.getRange(sesiRow, 6).setValue("selesai_" + (mode||"manual"));
    sesiSheet.getRange(sesiRow, 9).setValue(new Date());

    const hasil         = hitungNilai(nim, sesiId, urutanIds, mataKuliah);
    const jmlPelanggaran = getPelanggaranCount(nim, sesiId);
    logAksi(nim, "SUBMIT_"+(mode||"manual").toUpperCase(),
            mataKuliah+" | Nilai:"+hasil.nilai+" | Pelanggaran:"+jmlPelanggaran);

    return {ok:true, nilai:hasil.nilai, benar:hasil.benar, salah:hasil.salah,
            kosong:hasil.kosong, jumlahSoal, mataKuliah,
            mode:mode||"manual", pelanggaranCount:jmlPelanggaran};

  } catch(e) {
    return {ok:false, message:"Server sibuk, proses pengumpulan jawaban tertunda."};
  } finally {
    lock.releaseLock();
  }
}

function getSesiAktif({ nim, token }) {
  const tokenRes=verifyToken({nim,token});
  if (!tokenRes.ok) return {ok:false,sesiAda:false};
  const sesiData=getSheet(SHEET_SESI).getDataRange().getValues();
  for (let i=1;i<sesiData.length;i++) {
    if (String(sesiData[i][1]).trim()===String(nim).trim()&&String(sesiData[i][2]).trim().toUpperCase()===tokenRes.tokenId&&String(sesiData[i][5]).trim().toLowerCase()==="aktif")
      return {ok:true,sesiAda:true,sesiId:sesiData[i][0]};
  }
  return {ok:true,sesiAda:false};
}

function logPelanggaran({ nim, sesiId, jenis, detail, nomorSoal }) {
  if (!nim||!sesiId||!jenis) return {ok:false,message:"Data tidak lengkap."};
  const sheet=getSheet(SHEET_PELANGGARAN);
  sheet.appendRow([new Date(),String(nim),String(sesiId),String(jenis),String(detail||""),Number(nomorSoal||0)]);
  if (jenis==="DEVTOOLS"||jenis==="MULTI_DEVICE") sheet.getRange(sheet.getLastRow(),1,1,6).setBackground("#ffcccc");
  const count=getPelanggaranCount(nim,sesiId);
  logAksi(nim,"PELANGGARAN_"+jenis,"Soal #"+(nomorSoal||"?")+" | Total: "+count);
  if (count>=MAX_PELANGGARAN) {
    submitUjian({nim,sesiId,token:null,mode:"force_cheat"});
    return {ok:true,pelanggaranCount:count,forceSubmit:true,message:"Force submit."};
  }
  return {ok:true,pelanggaranCount:count,forceSubmit:false,peringatan:count>=WARN_PELANGGARAN,sisaKesempatan:MAX_PELANGGARAN-count};
}

function syncTimer({ nim, token }) {
  if (!nim||!token) return {ok:false};

  // Langkah 1: Validasi token dan ambil durasi
  const dataToken = getSheet(SHEET_TOKEN).getDataRange().getValues();
  let durasiMenit = 0, tAkhir = null;

  for (let i=1; i<dataToken.length; i++) {
    const [rToken,,rDurasi,,rAkhirDB,rStatus] = dataToken[i];
    if (String(rToken).trim().toUpperCase()===String(token).trim().toUpperCase()) {
      if (String(rStatus).trim().toLowerCase()!=="aktif") return {ok:false, expired:true};
      tAkhir      = new Date(rAkhirDB);
      durasiMenit = Number(rDurasi);
      break;
    }
  }
  if (!tAkhir) return {ok:false, expired:true};
  if (new Date() > tAkhir) return {ok:true, sisaDetik:0, expired:true};

  // Langkah 2: Cari sesi aktif mahasiswa ini → hitung sisa waktu dari WaktuMulai sesi
  // Lebih akurat daripada dari TanggalAkhir token karena memperhitungkan kapan
  // mahasiswa benar-benar mulai, bukan kapan token berakhir
  const dataSesi = getSheet(SHEET_SESI).getDataRange().getValues();
  for (let i=1; i<dataSesi.length; i++) {
    if (String(dataSesi[i][1]).trim()===String(nim).trim() &&
        String(dataSesi[i][2]).trim().toUpperCase()===String(token).trim().toUpperCase() &&
        String(dataSesi[i][5]).trim().toLowerCase()==="aktif") {

      const waktuMulai    = new Date(dataSesi[i][4]);
      const berjalanDetik = Math.floor((new Date() - waktuMulai) / 1000);
      let sisaDetikUjian  = (durasiMenit * 60) - berjalanDetik;

      if (sisaDetikUjian <= 0) return {ok:true, sisaDetik:0, expired:true};
      return {ok:true, sisaDetik:sisaDetikUjian, expired:false};
    }
  }

  // Sesi belum ada (mahasiswa belum mulai) — kembalikan sisa waktu token
  return {ok:true, sisaDetik: Math.floor((tAkhir - new Date()) / 1000), expired:false};
}

function getStatusSesi({ nim, sesiId, token }) {
  if (!nim||!sesiId) return {ok:false};
  const count=getPelanggaranCount(nim,sesiId);
  const jawabanMap=getJawabanMahasiswa(nim,sesiId);
  const timerRes=token?syncTimer({nim,token}):{ok:false};
  return {ok:true,pelanggaranCount:count,jawabanTerisi:Object.keys(jawabanMap).length,sisaDetik:timerRes.ok?timerRes.sisaDetik:null,forceSubmit:count>=MAX_PELANGGARAN};
}

// ═══════════════════════════════════════════════════════════
//  TAHAP 4: DASHBOARD DOSEN
// ═══════════════════════════════════════════════════════════

/**
 * loginDosen
 * Payload: { action, username, password }
 * Sheet Dosen: [Username, NamaLengkap, Password, Role]
 * Role: admin / dosen
 */
function loginDosen({ username, password }) {
  if (!username||!password) return {ok:false,message:"Username dan password wajib diisi."};
  const data = getSheet(SHEET_DOSEN).getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    const [rUser,rNama,rPass,rRole] = data[i];
    if (String(rUser).trim().toLowerCase()===String(username).trim().toLowerCase()) {
      if (String(rPass).trim()!==String(password).trim()) return {ok:false,message:"Password salah."};
      logAksi("DOSEN:"+rUser,"LOGIN_DOSEN",rNama);
      return {ok:true,username:String(rUser).trim(),nama:String(rNama).trim(),role:String(rRole||"dosen").trim()};
    }
  }
  return {ok:false,message:"Akun dosen tidak ditemukan."};
}

/**
 * getMonitorAktif
 * Return semua sesi yang sedang aktif + progress jawaban + pelanggaran
 * Payload: { action, username, password, token? }
 * token: filter per token tertentu (opsional)
 */
function getMonitorAktif({ username, password, tokenFilter }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;

  const sesiData   = getSheet(SHEET_SESI).getDataRange().getValues();
  const tokenData  = getSheet(SHEET_TOKEN).getDataRange().getValues();
  const mahData    = getSheet(SHEET_MAHASISWA).getDataRange().getValues();

  // Build lookup maps
  const tokenMap = {};
  for (let i=1;i<tokenData.length;i++) {
    const [rToken,rMK,rDurasi,rMulai,rAkhir,rStatus] = tokenData[i];
    tokenMap[String(rToken).trim().toUpperCase()] = {
      mataKuliah:String(rMK).trim(),
      durasi:Number(rDurasi),
      tAkhir:new Date(rAkhir),
      status:String(rStatus).trim()
    };
  }

  const mahMap = {};
  for (let i=1;i<mahData.length;i++) {
    const [rNim,rNama,,rProdi] = mahData[i];
    mahMap[String(rNim).trim()] = {nama:String(rNama).trim(),prodi:String(rProdi).trim()};
  }

  const now    = new Date();
  const result = [];

  for (let i=1;i<sesiData.length;i++) {
    const [sesiId,nim,tkn,mk,waktuMulai,status,urutanStr,jumlahSoal,waktuSelesai] = sesiData[i];
    if (String(status).trim().toLowerCase()!=="aktif") continue;
    if (tokenFilter && String(tkn).trim().toUpperCase()!==String(tokenFilter).trim().toUpperCase()) continue;

    const tknKey = String(tkn).trim().toUpperCase();
    const tInfo  = tokenMap[tknKey]||{};

    // Hitung jawaban terisi
    const jawabanMap = getJawabanMahasiswa(nim, sesiId);
    const terisi     = Object.keys(jawabanMap).length;

    // Hitung pelanggaran
    const pelanggaran = getPelanggaranCount(nim, sesiId);

    // Hitung sisa waktu
    const sisaDetik = tInfo.tAkhir ? Math.max(0,Math.floor((tInfo.tAkhir-now)/1000)) : null;

    // Durasi sudah mengerjakan
    const durasiBerjalan = waktuMulai ? Math.floor((now-new Date(waktuMulai))/60000) : 0;

    const mahInfo = mahMap[String(nim).trim()]||{nama:"—",prodi:"—"};

    result.push({
      sesiId:      String(sesiId).trim(),
      nim:         String(nim).trim(),
      nama:        mahInfo.nama,
      prodi:       mahInfo.prodi,
      token:       tknKey,
      mataKuliah:  String(mk).trim(),
      waktuMulai:  waktuMulai ? new Date(waktuMulai).toLocaleTimeString("id-ID") : "—",
      durasiBerjalan,
      jumlahSoal:  Number(jumlahSoal),
      terisi,
      sisaBelumDijawab: Number(jumlahSoal) - terisi,
      persen:      Number(jumlahSoal)>0 ? Math.round((terisi/Number(jumlahSoal))*100) : 0,
      pelanggaran,
      pelanggranStatus: pelanggaran===0?"aman":pelanggaran<WARN_PELANGGARAN?"perhatian":pelanggaran<MAX_PELANGGARAN?"berbahaya":"dikunci",
      sisaDetik
    });
  }

  // Urutkan: berbahaya dulu, lalu perhatian, lalu aman
  const order = {dikunci:0,berbahaya:1,perhatian:2,aman:3};
  result.sort((a,b) => (order[a.pelanggranStatus]||9)-(order[b.pelanggranStatus]||9));

  return { ok:true, sesiAktif:result, jumlah:result.length, timestamp: now.toLocaleTimeString("id-ID") };
}

/**
 * getRekapNilai
 * Semua sesi yang sudah selesai + nilai + pelanggaran
 * Payload: { action, username, password, tokenFilter? }
 */
function getRekapNilai({ username, password, tokenFilter }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;

  const sesiData  = getSheet(SHEET_SESI).getDataRange().getValues();
  const mahData   = getSheet(SHEET_MAHASISWA).getDataRange().getValues();
  const mahMap    = {};
  for (let i=1;i<mahData.length;i++) {
    const [rNim,rNama,,rProdi]=mahData[i];
    mahMap[String(rNim).trim()]={nama:String(rNama).trim(),prodi:String(rProdi).trim()};
  }

  const result = [];
  for (let i=1;i<sesiData.length;i++) {
    const [sesiId,nim,tkn,mk,waktuMulai,status,urutanStr,jumlahSoal,waktuSelesai] = sesiData[i];
    if (!String(status).toLowerCase().startsWith("selesai")) continue;
    if (tokenFilter && String(tkn).trim().toUpperCase()!==String(tokenFilter).trim().toUpperCase()) continue;

    const urutanIds  = JSON.parse(String(urutanStr)||"[]");
    const hasil      = hitungNilai(nim, sesiId, urutanIds, mk);
    const pelanggaran= getPelanggaranCount(nim, sesiId);
    const mahInfo    = mahMap[String(nim).trim()]||{nama:"—",prodi:"—"};
    const modeFinal  = String(status).replace("selesai_","");

    // Durasi pengerjaan
    let durMenit = "—";
    if (waktuMulai&&waktuSelesai) {
      durMenit = Math.round((new Date(waktuSelesai)-new Date(waktuMulai))/60000)+" mnt";
    }

    result.push({
      nim:         String(nim).trim(),
      nama:        mahInfo.nama,
      prodi:       mahInfo.prodi,
      mataKuliah:  String(mk).trim(),
      token:       String(tkn).trim().toUpperCase(),
      nilai:       hasil.nilai,
      benar:       hasil.benar,
      salah:       hasil.salah,
      kosong:      hasil.kosong,
      jumlahSoal:  Number(jumlahSoal),
      pelanggaran,
      modeFinal,
      durasi:      durMenit,
      waktuMulai:  waktuMulai?new Date(waktuMulai).toLocaleString("id-ID"):"—",
      waktuSelesai:waktuSelesai?new Date(waktuSelesai).toLocaleString("id-ID"):"—",
      predikat:    hasil.nilai>=85?"Sangat Baik":hasil.nilai>=75?"Baik":hasil.nilai>=60?"Cukup":"Kurang"
    });
  }

  // Urutkan: nilai tertinggi dulu
  result.sort((a,b) => b.nilai - a.nilai);

  return { ok:true, rekap:result, jumlah:result.length };
}

/**
 * getRekapPelanggaran
 * Semua pelanggaran detail per sesi
 */
function getRekapPelanggaran({ username, password, tokenFilter }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;

  const pData  = getSheet(SHEET_PELANGGARAN).getDataRange().getValues();
  const mahData= getSheet(SHEET_MAHASISWA).getDataRange().getValues();
  const mahMap = {};
  for (let i=1;i<mahData.length;i++){const [n,nm]=mahData[i]; mahMap[String(n).trim()]=String(nm).trim();}

  const result = [];
  for (let i=1;i<pData.length;i++) {
    const [ts,nim,sesiId,jenis,detail,nomorSoal]=pData[i];
    // Filter by token if needed
    if (tokenFilter && !String(sesiId).includes(String(tokenFilter).toUpperCase())) continue;
    result.push({
      waktu:     ts?new Date(ts).toLocaleString("id-ID"):"—",
      nim:       String(nim).trim(),
      nama:      mahMap[String(nim).trim()]||"—",
      sesiId:    String(sesiId).trim(),
      jenis:     String(jenis).trim(),
      detail:    String(detail||"").trim(),
      nomorSoal: Number(nomorSoal||0),
      berat:     ["DEVTOOLS","MULTI_DEVICE"].includes(String(jenis))
    });
  }

  // Agregasi per mahasiswa
  const byNim = {};
  result.forEach(r => {
    if (!byNim[r.nim]) byNim[r.nim]={nim:r.nim,nama:r.nama,total:0,jenis:{}};
    byNim[r.nim].total++;
    byNim[r.nim].jenis[r.jenis]=(byNim[r.nim].jenis[r.jenis]||0)+1;
  });
  const agregasi = Object.values(byNim).sort((a,b)=>b.total-a.total);

  return { ok:true, detail:result, agregasi, jumlah:result.length };
}

/**
 * getDashboardStats
 * Statistik ringkas untuk header dashboard
 */
function getDashboardStats({ username, password }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;

  const sesiData  = getSheet(SHEET_SESI).getDataRange().getValues();
  const mahData   = getSheet(SHEET_MAHASISWA).getDataRange().getValues();
  const pData     = getSheet(SHEET_PELANGGARAN).getDataRange().getValues();
  const tokenData = getSheet(SHEET_TOKEN).getDataRange().getValues();

  let aktif=0, selesai=0, nilaiSum=0, nilaiCount=0;
  const nilaiDist = {A:0,B:0,C:0,D:0}; // A≥85, B≥75, C≥60, D<60
  const mkStats   = {};

  for (let i=1;i<sesiData.length;i++) {
    const [sesiId,nim,tkn,mk,,status,urutanStr,jumlahSoal] = sesiData[i];
    const st = String(status).trim().toLowerCase();
    if (st==="aktif") { aktif++; continue; }
    if (!st.startsWith("selesai")) continue;
    selesai++;
    const h = hitungNilai(nim, sesiId, JSON.parse(String(urutanStr)||"[]"), mk);
    nilaiSum += h.nilai; nilaiCount++;
    if (h.nilai>=85) nilaiDist.A++;
    else if (h.nilai>=75) nilaiDist.B++;
    else if (h.nilai>=60) nilaiDist.C++;
    else nilaiDist.D++;
    if (!mkStats[mk]) mkStats[mk]={total:0,sum:0};
    mkStats[mk].total++; mkStats[mk].sum+=h.nilai;
  }

  const rataRata = nilaiCount>0?Math.round(nilaiSum/nilaiCount):0;
  const totalMahasiswa = Math.max(mahData.length-1,0);
  const totalPelanggaran = Math.max(pData.length-1,0);

  // Token aktif
  const now=new Date();
  let tokenAktif=0;
  for (let i=1;i<tokenData.length;i++) {
    const [,,,,rAkhir,rStatus]=tokenData[i];
    if (String(rStatus).trim().toLowerCase()==="aktif"&&new Date(rAkhir)>now) tokenAktif++;
  }

  const mkList = Object.entries(mkStats).map(([mk,v])=>({mk,total:v.total,rataRata:Math.round(v.sum/v.total)}));

  return {
    ok:true,
    aktif, selesai, rataRata,
    totalMahasiswa, totalPelanggaran, tokenAktif,
    nilaiDist, mkList,
    belumMulai: totalMahasiswa - aktif - selesai
  };
}

/**
 * forceSubmitMahasiswaDosen
 * Dosen bisa paksa submit sesi mahasiswa tertentu
 */
function forceSubmitMahasiswaDosen({ username, password, nim, sesiId }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;
  logAksi("DOSEN:"+username,"FORCE_SUBMIT_DOSEN","NIM:"+nim+" SesiID:"+sesiId);
  return submitUjian({nim, sesiId, token:null, mode:"force_dosen"});
}

/**
 * resetSesiMahasiswa
 * Dosen bisa nonaktifkan sesi agar mahasiswa bisa mulai ulang
 */
function resetSesiMahasiswa({ username, password, sesiId }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;
  const sesiSheet = getSheet(SHEET_SESI);
  const sesiData  = sesiSheet.getDataRange().getValues();
  for (let i=1;i<sesiData.length;i++) {
    if (String(sesiData[i][0]).trim()===String(sesiId).trim()) {
      sesiSheet.getRange(i+1,6).setValue("nonaktif_reset");
      logAksi("DOSEN:"+username,"RESET_SESI","SesiID:"+sesiId);
      return {ok:true,message:"Sesi berhasil direset."};
    }
  }
  return {ok:false,message:"Sesi tidak ditemukan."};
}

/**
 * getTokenList — daftar semua token
 */
function getTokenList({ username, password }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;
  const data = getSheet(SHEET_TOKEN).getDataRange().getValues();
  const now  = new Date();
  const list = [];
  for (let i=1;i<data.length;i++) {
    const [rToken,rMK,rDurasi,rMulai,rAkhir,rStatus] = data[i];
    const tA = new Date(rAkhir);
    list.push({
      token:      String(rToken).trim(),
      mataKuliah: String(rMK).trim(),
      durasi:     Number(rDurasi),
      mulai:      rMulai?new Date(rMulai).toLocaleString("id-ID"):"—",
      akhir:      rAkhir?tA.toLocaleString("id-ID"):"—",
      status:     String(rStatus).trim(),
      expired:    tA < now,
      row:        i+1
    });
  }
  return {ok:true, list};
}

/**
 * buatToken — buat token baru
 */
function buatToken({ username, password, token, mataKuliah, durasi, mulai, akhir }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;
  if (!token||!mataKuliah||!durasi||!mulai||!akhir) return {ok:false,message:"Semua field wajib diisi."};
  getSheet(SHEET_TOKEN).appendRow([token.toUpperCase().trim(), mataKuliah, Number(durasi), new Date(mulai), new Date(akhir), "aktif"]);
  logAksi("DOSEN:"+username,"BUAT_TOKEN",token+" | "+mataKuliah);
  return {ok:true,message:"Token berhasil dibuat."};
}

/**
 * nonaktifkanToken
 */
function nonaktifkanToken({ username, password, token }) {
  const auth = loginDosen({username, password});
  if (!auth.ok) return auth;
  const sheet = getSheet(SHEET_TOKEN);
  const data  = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if (String(data[i][0]).trim().toUpperCase()===String(token).trim().toUpperCase()) {
      sheet.getRange(i+1,6).setValue("nonaktif");
      logAksi("DOSEN:"+username,"NONAKTIF_TOKEN",token);
      return {ok:true,message:"Token dinonaktifkan."};
    }
  }
  return {ok:false,message:"Token tidak ditemukan."};
}

// ─────────────────────────────────────────────
//  HELPERS SOAL & NILAI
// ─────────────────────────────────────────────
function getSoalByMataKuliah(mataKuliah) {
  const data=getSheet(SHEET_SOAL).getDataRange().getValues(), soal=[];
  for (let i=1;i<data.length;i++) {
    const [id,mk,p,a,b,c,d,kunci,tingkat]=data[i];
    if (String(mk).trim().toLowerCase()===String(mataKuliah).trim().toLowerCase())
      soal.push({id:String(id).trim(),pertanyaan:String(p).trim(),
        opsi:[{kode:"A",teks:String(a||"").trim()},{kode:"B",teks:String(b||"").trim()},{kode:"C",teks:String(c||"").trim()},{kode:"D",teks:String(d||"").trim()}].filter(o=>o.teks),
        kunci:String(kunci).trim().toUpperCase(),tingkat:String(tingkat||"sedang").trim()});
  }
  return soal;
}
function getSoalByIds(ids, mataKuliah) {
  const map={};
  getSoalByMataKuliah(mataKuliah).forEach(s=>{map[s.id]={id:s.id,pertanyaan:s.pertanyaan,opsi:s.opsi,tingkat:s.tingkat};});
  return ids.map(id=>map[id]).filter(Boolean);
}
function getJawabanMahasiswa(nim, sesiId) {
  const data=getSheet(SHEET_JAWABAN).getDataRange().getValues(), map={};
  for (let i=1;i<data.length;i++)
    if (String(data[i][0]).trim()===String(nim).trim()&&String(data[i][1]).trim()===String(sesiId).trim())
      map[String(data[i][2]).trim()]=String(data[i][3]).trim();
  return map;
}
function hitungNilai(nim, sesiId, urutanIds, mataKuliah) {
  const jMap=getJawabanMahasiswa(nim,sesiId),kMap={};
  getSoalByMataKuliah(mataKuliah).forEach(s=>kMap[s.id]=s.kunci);
  let benar=0,salah=0,kosong=0;
  urutanIds.forEach(id=>{const j=jMap[id],k=kMap[id];if(!j){kosong++;return;} j.toUpperCase()===k?benar++:salah++;});
  return {nilai:urutanIds.length>0?Math.round((benar/urutanIds.length)*100):0,benar,salah,kosong};
}
function getPelanggaranCount(nim, sesiId) {
  try {
    const data=getSheet(SHEET_PELANGGARAN).getDataRange().getValues();
    let c=0;
    for (let i=1;i<data.length;i++)
      if (String(data[i][1]).trim()===String(nim).trim()&&String(data[i][2]).trim()===String(sesiId).trim()) c++;
    return c;
  } catch(e){return 0;}
}
function shuffleWithSeed(arr, seed) {
  const a=[...arr]; let s=hashSeed(String(seed));
  const rand=()=>{s=(s*1664525+1013904223)&0xffffffff;return (s>>>0)/0x100000000;};
  for (let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function hashSeed(str){let h=5381;for(let i=0;i<str.length;i++)h=((h<<5)+h)^str.charCodeAt(i);return h>>>0;}
function logAksi(nim, aksi, detail) {
  try{getSheet(SHEET_LOG).appendRow([new Date(),String(nim),String(aksi),String(detail)]);}catch(e){}
}
function getSheet(name) {
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet=ss.getSheetByName(name);
  if (!sheet) {
    sheet=ss.insertSheet(name);
    const h={
      [SHEET_MAHASISWA]:  ["NIM","Nama","Password","Prodi","Status"],
      [SHEET_TOKEN]:      ["Token","MataKuliah","Durasi(menit)","TanggalMulai","TanggalAkhir","Status"],
      [SHEET_SOAL]:       ["ID","MataKuliah","Pertanyaan","OpsiA","OpsiB","OpsiC","OpsiD","KunciJawaban","Tingkat"],
      [SHEET_SESI]:       ["SesiID","NIM","Token","MataKuliah","WaktuMulai","Status","UrutanSoal","JumlahSoal","WaktuSelesai"],
      [SHEET_JAWABAN]:    ["NIM","SesiID","SoalID","Jawaban","Timestamp"],
      [SHEET_PELANGGARAN]:["Timestamp","NIM","SesiID","Jenis","Detail","NomorSoal"],
      [SHEET_DOSEN]:      ["Username","NamaLengkap","Password","Role"],
      [SHEET_LOG]:        ["Timestamp","NIM","Aksi","Detail"],
    };
    if (h[name]) sheet.appendRow(h[name]);
  }
  return sheet;
}

// ─────────────────────────────────────────────
//  PWA
// ─────────────────────────────────────────────
function serveManifest() {
  return ContentService.createTextOutput(JSON.stringify({
    name:"CBT Universitas",short_name:"CBT",start_url:"./",display:"standalone",
    background_color:"#0f172a",theme_color:"#3b82f6",orientation:"portrait",
    icons:[{src:"https://placehold.co/192x192/3b82f6/ffffff?text=CBT",sizes:"192x192",type:"image/png"},
           {src:"https://placehold.co/512x512/3b82f6/ffffff?text=CBT",sizes:"512x512",type:"image/png"}]
  })).setMimeType(ContentService.MimeType.JSON);
}
function serveServiceWorker() {
  return ContentService.createTextOutput(`
    self.addEventListener('install',()=>self.skipWaiting());
    self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
    self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));
  `).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ═══════════════════════════════════════════════════════════
//  SETUP — Jalankan setupLengkap() SEKALI saja
// ═══════════════════════════════════════════════════════════
function setupLengkap() {
  // Mahasiswa
  const sheetM=getSheet(SHEET_MAHASISWA);
  if (sheetM.getLastRow()<=1){
    sheetM.appendRow(["2021001","Budi Santoso","budi123","Teknik Informatika","aktif"]);
    sheetM.appendRow(["2021002","Siti Rahayu","siti123","Teknik Informatika","aktif"]);
    sheetM.appendRow(["2021003","Ahmad Fauzi","ahmad123","Sistem Informasi","aktif"]);
  }
  // Token
  const sheetT=getSheet(SHEET_TOKEN);
  if (sheetT.getLastRow()<=1){
    const now=new Date(),akhir=new Date(now.getTime()+24*60*60*1000);
    sheetT.appendRow(["UJIAN2024","Pemrograman Web",90,now,akhir,"aktif"]);
    sheetT.appendRow(["ALGO2024","Algoritma",60,now,akhir,"aktif"]);
  }
  // Soal
  const sheetS=getSheet(SHEET_SOAL);
  if (sheetS.getLastRow()<=1){
    [["PW001","Pemrograman Web","Tag HTML untuk hyperlink...","<a>","<link>","<href>","<url>","A","mudah"],
     ["PW002","Pemrograman Web","CSS singkatan dari...","Cascading Style Sheets","Creative Style Sheets","Computer Style Sheets","Colorful Style Sheets","A","mudah"],
     ["PW003","Pemrograman Web","Properti CSS warna teks...","color","font-color","text-color","foreground","A","mudah"],
     ["PW004","Pemrograman Web","Selektor ID dalam CSS...","#header",".header","+header","*header","A","mudah"],
     ["PW005","Pemrograman Web","Metode HTTP kirim form aman...","POST","GET","PUT","HEAD","A","sedang"],
     ["PW006","Pemrograman Web","JS pilih elemen by ID...","getElementById()","getElement()","findById()","selectId()","A","sedang"],
     ["PW007","Pemrograman Web","Output typeof null...","object","null","undefined","string","A","sedang"],
     ["PW008","Pemrograman Web","BUKAN tipe input HTML5...","<input type='color'>","<input type='date'>","<input type='phone'>","<input type='range'>","C","sedang"],
     ["PW009","Pemrograman Web","Box model urutan luar ke dalam...","Margin-Border-Padding-Content","Border-Margin-Padding-Content","Padding-Border-Margin-Content","Content-Padding-Border-Margin","A","sulit"],
     ["PW010","Pemrograman Web","Event DOM selesai dimuat...","DOMContentLoaded","onload","DOMReady","pageshow","A","sulit"],
     ["AL001","Algoritma","Binary Search terbaik...","O(1)","O(n)","O(log n)","O(n²)","A","sedang"],
     ["AL002","Algoritma","Struktur LIFO adalah...","Stack","Queue","Tree","Graph","A","mudah"],
     ["AL003","Algoritma","Sorting O(n log n) rata-rata...","Quick Sort","Bubble Sort","Insertion Sort","Selection Sort","A","sedang"],
     ["AL004","Algoritma","Rekursi wajib memiliki...","Base case dan recursive case","Hanya recursive case","Hanya base case","Loop dan kondisi","A","mudah"],
     ["AL005","Algoritma","Big-O nested loop...","O(n²)","O(n)","O(2n)","O(log n)","A","sedang"],
    ].forEach(r=>sheetS.appendRow(r));
  }
  // Dosen
  const sheetD=getSheet(SHEET_DOSEN);
  if (sheetD.getLastRow()<=1){
    sheetD.appendRow(["admin","Administrator","admin123","admin"]);
    sheetD.appendRow(["arasyadi","Andy Rasyadi, S.Pi., M.Si.","dosen1998","dosen"]);
  }
  getSheet(SHEET_SESI);getSheet(SHEET_JAWABAN);getSheet(SHEET_PELANGGARAN);getSheet(SHEET_LOG);
  Logger.log("Setup Tahap 4 selesai! Akun dosen: admin/admin123 atau dosen1/dosen123");
}
