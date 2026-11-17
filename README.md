# vercel-php-fix

Pembungkus tipis di atas [`vercel-php@0.8.0`](https://github.com/vercel-community/php) yang memperbaiki crash pada build Vercel baru:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/launcher.launcher'
  imported from /opt/rust/nodejs.js
Application exited with code 1.
```

Masalah ini dilaporkan di [vercel-community/php#650](https://github.com/vercel-community/php/issues/650). Runtime aslinya diarsipkan
(read-only) sehingga perbaikannya ([PR #654](https://github.com/vercel-community/php/pull/654)) tidak akan di-merge.

> **Status: eksperimental.** Diuji dengan tes unit dan uji ujung-ke-ujung terhadap server PHP lokal,
> belum diuji di build Vercel nyata sampai Anda memakainya di preview.

## Cara kerja
`vercel-php` membuat fungsi dengan `handler: 'launcher.launcher'`. Bootstrap Vercel yang baru membacanya sebagai nama file.
Paket ini memanggil `vercel-php` apa adanya (unduh file, `composer install`, `php.ini`, biner PHP), lalu:

1. membungkus ulang hasilnya sebagai `NodejsLambda` dengan `handler: 'launcher.js'` dan `awsLambdaHandler: 'launcher.launcher'`;
2. mengganti `helpers.js` dengan versi yang tahan terhadap `LAMBDA_TASK_ROOT` kosong dan body request berupa `Buffer`/array byte
   (tanpa ini, POST bisa 502);
3. mengganti `launcher.js` agar server PHP memakai **port bebas acak** di `127.0.0.1` (versi asli menulis mati port 3000, yang
   di bootstrap baru bisa terpakai server Vercel sehingga muncul `SyntaxError: Unexpected end of JSON input` di
   `/opt/rust/nodejs.js`), serta menahan permintaan yang datang bersamaan saat start dingin sampai server PHP siap.

## Pemakaian
Di `vercel.json` proyek, ganti runtime dengan **commit tertentu** repo ini (jangan pakai branch bergerak):

```json
{
  "functions": {
    "api/index.php": {
      "runtime": "github:<akun>/vercel-php-fix#<commit-sha>",
      "maxDuration": 60
    }
  }
}
```

Vercel CLI menjalankan `npm install` untuk nilai `runtime`, jadi spec GitHub didukung. Repo harus **publik**.

## Tes
```bash
# unit: butuh @vercel/build-utils (mis. milik Vercel CLI) agar kelas Lambda asli bisa dipakai
NODE_PATH="<lokasi>/vercel/node_modules" node test/run.js

# ujung-ke-ujung: butuh PHP di PATH (atau PHP_DIR); termasuk server pengecoh di port 3000
node test/e2e.js
```

## Catatan keamanan
Paket ini dijalankan di proses build Anda. Kodenya sengaja kecil (`index.js`, `launchers/helpers.js`) agar mudah dibaca.
Pin selalu ke commit SHA, dan tinjau perubahan sebelum memperbarui pin.

## Atribusi dan lisensi
MIT. `launchers/helpers.js` diturunkan dari `vercel-php` (© 2019 Milan Felix Sulc) dengan perubahan dari
PR #654 vercel-community/php.
