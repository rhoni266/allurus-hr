# Pencetus berjadual integrasi akaun

`/api/integration/dispatch` (GET atau POST) melakukan dua perkara, kedua-duanya selamat diulang:

1. **Meterai** hari yang sedia bagi setiap outlet tenant bermod `allurus` dengan sambungan aktif. Satu hari ialah syif yang dibuka pada tarikh itu (waktu outlet) dan sedia apabila semuanya sudah ditutup (sehingga semalam, paling banyak 31 hari ke belakang sekali jalan). Berhenti pada hari pertama yang belum sedia, contohnya syif terlupa ditutup, supaya tiada hari dilangkau; pemilik melihat syif itu pada skrin Integrasi.
2. **Hantar** jurnal yang sudah tiba masanya (cuba semula dengan backoff, dead letter selepas 8 percubaan).

Tiada proses latar dalam aplikasi. Sesuatu mesti memanggilnya, sama ada Vercel Cron, jadual GitHub Actions atau mana-mana pemanggil HTTP.

## Tetapan (pemilik, sekali; tiada nilai dalam repo)

- `CRON_SECRET`: rentetan rawak sekurang-kurangnya 16 aksara dalam persekitaran hos. Panggilan mesti membawa `Authorization: Bearer <CRON_SECRET>` (itulah yang Vercel Cron hantar). Tanpa `CRON_SECRET` titik akhir tertutup (503); token salah ialah 401.
- Rahsia HMAC per tenant: satu pembolehubah persekitaran bagi setiap nama rahsia yang disimpan dalam tetapan integrasi (contoh `ALLURUS_SECRET_ACME`).
- Jadual cadangan: setiap 10 hingga 15 minit. Jurnal hanya dimeterai selepas hari tamat, jadi jarang lebih kerap pun tidak mengapa.

Jawapan hanya mengandungi bilangan (`sealed` dan `sent`), tidak pernah rahsia, jurnal atau mesej pangkalan data. Mod standalone tidak terjejas: tenant tanpa mod `allurus` dan sambungan aktif tidak disentuh.
