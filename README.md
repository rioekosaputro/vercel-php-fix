# vercel-php-fix

Pembungkus tipis di atas [`vercel-php@0.8.0`](https://github.com/vercel-community/php) yang memperbaiki crash pada build Vercel baru:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/launcher.launcher'
  imported from /opt/rust/nodejs.js
Application exited with code 1.
```

Masalah ini dilaporkan di [vercel-community/php#650](https://github.com/vercel-community/php/issues/650). Runtime aslinya diarsipkan
(read-only) sehingga perbaikannya ([PR #654](https://github.com/vercel-community/php/pull/654)) tidak akan di-merge.

> **Status:** dipakai di produksi untuk satu aplikasi Laravel 12 (PHP 8.4, Vercel Hobby) dengan mode `http`.
> Mode `lambda` (meniru PR #654) **tidak berhasil** pada bootstrap Vercel yang diuji (lihat tabel di bawah).

## Cara kerja
`vercel-php` membuat fungsi dengan `handler: 'launcher.launcher'`. Bootstrap Vercel yang baru membacanya sebagai nama file.
Paket ini memanggil `vercel-php` apa adanya (unduh file, `composer install`, `php.ini`, biner PHP), lalu membungkus ulang
hasilnya sebagai `NodejsLambda`. Dua mode, dipilih lewat `config.mode`:

| Mode | Apa yang terjadi | Status |
|---|---|---|
| `http` | `launcher.js` adalah fungsi Node standar `(req, res)`. Request HTTP asli diteruskan (reverse proxy) ke server PHP Built-In di `127.0.0.1` pada port bebas acak. Tidak memakai event Lambda. | **Disarankan, teruji di produksi** |
| `lambda` (bawaan, demi kompatibilitas) | `handler: 'launcher.js'` + `awsLambdaHandler: 'launcher.launcher'` (cara PR #654). Bootstrap memanggil launcher dengan event gaya API Gateway. | Pada uji kami: fungsi hang sampai timeout 60 dtk, bootstrap melempar `SyntaxError: Unexpected end of JSON input` di `/opt/rust/nodejs.js` sebelum launcher dipanggil |

Perbaikan lain yang ikut: port server PHP acak (bukan `3000` yang ditulis mati), permintaan bersamaan saat start dingin menunggu
server siap, server dijalankan ulang bila prosesnya mati, `LAMBDA_TASK_ROOT` kosong ditangani, dan body request (string/Buffer/array byte)
dinormalkan pada mode `lambda`.

## Pemakaian
Pakai `builds` di `vercel.json` (bukan `functions.runtime`, yang menolak spesifikasi GitHub) dan **kunci ke commit SHA**:

```json
{
  "version": 2,
  "framework": null,
  "builds": [
    {
      "src": "api/index.php",
      "use": "github:<akun>/vercel-php-fix#<commit-sha>",
      "config": { "maxDuration": 60, "mode": "http" }
    },
    { "src": "public/**", "use": "@vercel/static" }
  ],
  "routes": [{ "src": "/(.*)", "dest": "/api/index.php" }]
}
```

Vercel CLI menjalankan `npm install` untuk nilai `use`, jadi spesifikasi GitHub didukung. Repo harus **publik** dan jangan dihapus:
bila hilang atau menjadi private, build gagal.

`config.maxDuration` (bilangan bulat positif) diteruskan sebagai batas durasi fungsi.

## Fungsi probe (diagnostik, jangan dipakai di produksi)
`config.probe: true` membuat fungsi TANPA PHP (`launchers/probe-http.js` atau `probe-lambda.js`) yang melaporkan versi Node, nama variabel
lingkungan bawaan platform, isi `/opt` dan `/var/task`, serta dapat menampilkan potongan kode bootstrap Vercel
(`?find=teks` atau `?slice=baris:awal-akhir` pada `/opt/rust/nodejs.js`). Berguna untuk memahami kontrak pemanggilan handler
bila Vercel mengubahnya lagi. Pasang di branch percobaan dan hapus sesudahnya karena endpoint-nya terbuka untuk publik.

## Catatan penting
- **Versi PHP** ditentukan oleh runtime, bukan `composer.json`: `vercel-php@0.8.0` membawa PHP 8.4 (mis. 8.4.27). Paket biner
  `@libphp/amazon-linux-2023-v84` dideklarasikan sebagai `>=0.0.8`, **tidak dikunci**; build memakai versi terbaru yang tersedia
  (saat ini 0.0.9). Pengelolanya telah mengarsipkan proyek, jadi praktis beku, tapi bukan karena pin Anda.
- **Tidak ada pembaruan dari hulu.** `vercel-php` diarsipkan; tidak akan ada versi baru. Pembaruan platform Vercel di masa depan
  bisa merusak lagi. Mode `http` bergantung pada kontrak Node `(req, res)` dasar sehingga lebih kecil kemungkinannya, tapi tanpa jaminan.

## Bila rusak lagi
1. **Build gagal:** produksi tidak terganggu (Vercel tidak mengganti produksi dengan build gagal). Baca log build.
2. **Build sukses tetapi fungsi crash** (500 atau hang): lakukan Instant Rollback ke deployment sebelumnya di dashboard Vercel
   (jangan Redeploy), lalu diagnosis di branch preview.
3. Pasang fungsi probe (`config.probe`) pada branch preview, buka `/__probe/http?find=...` untuk membaca potongan bootstrap
   yang gagal, dan bandingkan dengan `launchers/http.js`.
4. Log runtime Vercel tidak mencantumkan nama deployment; catat jam tes agar log bisa dicocokkan dengan deployment yang diuji.

## Tes
```bash
# unit: butuh @vercel/build-utils (mis. milik Vercel CLI) agar kelas Lambda asli bisa dipakai
NODE_PATH="<lokasi>/vercel/node_modules" node test/run.js

# ujung-ke-ujung: butuh PHP di PATH (atau PHP_DIR); termasuk server pengecoh di port 3000
node test/e2e.js        # mode lambda
node test/e2e-http.js   # mode http: GET/POST, dua Set-Cookie, redirect, respons 2 MB, HEAD
```

## Catatan keamanan
Paket ini dijalankan di proses build Anda. Kodenya sengaja kecil agar mudah dibaca.
Pin selalu ke commit SHA, dan tinjau perubahan sebelum memperbarui pin.

## Atribusi dan lisensi
MIT. `launchers/helpers.js` dan bagian dari `launchers/phpserver.js` diturunkan dari `vercel-php` (© 2019 Milan Felix Sulc)
dengan perubahan dari PR #654 vercel-community/php.
