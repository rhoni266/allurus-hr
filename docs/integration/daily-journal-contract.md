# Kontrak jurnal harian POS ke sistem akaun (draf untuk dipersetujui dengan Allurus)

Status: **DRAF dari sisi possaas.** Kod `allurus-hr` tidak boleh dicapai dari sesi ini, jadi tiada nama medan atau titik akhir Allurus yang diteka. Semua yang di bawah ialah apa yang possaas akan hantar. Allurus memetakan kekunci akaun neutral ke carta akaunnya sendiri. Sumber kebenaran skema ialah `src/lib/integration/journal.ts`; [daily-journal.schema.json](daily-journal.schema.json) dijana daripadanya (ujian gagal jika terpesong) dan [daily-journal.example.json](daily-journal.example.json) ialah contoh yang lulus pengesahan.

## Keputusan pemilik

- **Satu jurnal per outlet per hari perniagaan**, bukan per syif. Varians tunai sehari ialah satu baris.
- **Tarikh perniagaan = tarikh (zon masa outlet) syif dibuka** (kemas kini 2026-11-14, menggantikan "hari kalendar `created_at`"). Syif yang melepasi tengah malam kekal pada tarikh pembukaannya. Oleh itu **tiada waktu potong lewat malam** dan soalan itu tidak lagi perlu dijawab.
- Pembatalan (void) dan bayaran balik selepas hari ditutup ialah **pelarasan dalam jurnal hari syif semasa**. Jurnal lama tidak dibuka semula.
- **Satu syarikat Allurus bagi satu tenant POS**; outlet ialah dimensi. Medan `outlet_id` dibawa dalam jurnal; jika Allurus belum ada dimensi outlet, ia disimpan dalam metadata baris (sambungan, dicatat di bawah).
- Kunci idempoten: `tenant_id:outlet_id:business_date:version`. Debit mesti sama kredit dalam sen, jika tidak jurnal ditolak (di sisi possaas sebelum dihantar, dan Allurus patut menolak juga).

## Hari perniagaan = syif yang dibuka pada tarikh itu

Tarikh sesuatu syif ialah tarikh kalendar pembukaannya dalam zon masa outlet (`outlets.timezone`, lalai `Asia/Kuala_Lumpur`; contoh syif dibuka 23:30 waktu Malaysia pada 10hb ialah 10hb walaupun 15:30 UTC). Satu hari ialah semua syif yang dibuka pada tarikh itu; dua syif sehari menjadi satu jurnal.

Apa yang masuk jurnal tarikh itu:

- **Jualan**: pesanan yang direkod dalam syif tersebut (`orders.shift_id`). Jualan offline yang sampai lewat ke pelayan direkod dalam syif yang **terbuka ketika ia disegerakkan** (dasar K5), jadi ia masuk hari syif itu, bukan hari ia dibuat di tablet. Jurnal hari lepas yang sudah dimeterai tidak disentuh.
- **Void dan bayaran balik**: dalam syif tempat ia direkod. Void di dalam syif yang sama dengan jualan: dalam syif itu. Void pesanan syif yang sudah ditutup: syif terbuka yang memulangkan wang. Bayaran balik: syif dalam `refunds.shift_id`.
- **Varians tunai**: jumlah `cash_difference` syif-syif tarikh itu (selepas ditutup).

Pembalikan jualan hari lepas masuk hari syif semasa, dengan tarikh jualan asal dalam `metadata.adjusts_business_dates` (tarikh ialah tarikh pembukaan syif jualan itu).

## Bilakah satu hari sedia (dibina)

Hari **sedia** hanya apabila **semua syif yang dibuka pada tarikh itu sudah ditutup**, dan tarikh itu sudah lalu dalam zon masa outlet (supaya syif kedua pada hari yang sama tidak tertinggal selepas jurnal dimeterai). Selagi ada syif terbuka, pembina memulangkan `not_ready` (`shift_open`) bersama senarai syif (id dan masa buka), walaupun belum ada jualan; hari yang belum berakhir ialah `not_ready` (`day_not_over`). Hari tanpa syif yang dibuka, atau yang syifnya tidak menghasilkan sebarang baris, tidak menghasilkan jurnal.

Syif yang terlupa ditutup menahan **tarikhnya dan semua hari selepasnya**: penghantar memeterai hari mengikut tertib dan berhenti pada hari pertama `not_ready`, jadi tiada hari dilangkau. Skrin pemilik (`/pos/integration`) menyenaraikan "Ditahan kerana syif belum ditutup" dengan outlet, tarikh, id syif dan masa ia dibuka. Setelah dibina, jurnal dengan kunci yang sama tidak dikira semula: yang pertama kekal.

## Baris (satu baris bagi satu akaun, sudah dinetkan untuk hari itu)

| Kekunci akaun     | Sisi lazim   | Isi                                                                                                                                                    |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cash`            | debit        | Tunai diterima, tolak baki yang dipulangkan kepada pelanggan, tolak tunai bayaran balik hari itu.                                                      |
| `card`            | debit        | Bayaran kad, tolak bayaran balik kad.                                                                                                                  |
| `duitnow_qr`      | debit        | Bayaran DuitNow QR, tolak bayaran balik.                                                                                                               |
| `ewallet`         | debit        | Bayaran e-dompet, tolak bayaran balik.                                                                                                                 |
| `sales`           | kredit       | Jualan bersih: jumlah tolak SST, caj servis dan pembundaran. Diskaun (jika ada) sudah ditolak.                                                         |
| `service_charge`  | kredit       | Caj servis (hanya jika dihidupkan).                                                                                                                    |
| `sst_output`      | kredit       | SST output dikutip, tolak SST dibalikkan.                                                                                                              |
| `rounding`        | kredit/debit | Pembundaran 5 sen bersih: positif (pelanggan bayar lebih) kredit, negatif debit.                                                                       |
| `cash_over_short` | kredit/debit | Varians tunai syif yang dibuka pada hari itu: tunai lebih = kredit (dan debit pada `cash`), tunai kurang = debit (dan kredit pada `cash`). Satu baris. |

Sisi dikira daripada nilai bersih: jika jumlah bersih sesuatu akaun negatif pada sisi lazimnya (contoh hari yang hanya ada bayaran balik), barisnya bertukar sisi. Jumlah sifar tidak dihantar. Pergerakan tunai (cash in/out) bukan sebahagian daripada jurnal jualan.

Bayaran balik separa diagihkan kepada bersih, caj servis, SST dan pembundaran mengikut kadar asal pesanan (tepat dalam sen, baki ke baris terbesar). Void dan bayaran balik penuh membalikkan komponen asal dengan tepat.

## Pembalikan, tidak membuka semula

Pesanan RM100 dalam syif yang dibuka pada 13hb, di-void dalam syif yang dibuka pada 14hb: jurnal 13 mengandungi jualan itu; jurnal 14 mengandungi pembalikannya dan menyenaraikan `13` dalam `metadata.adjusts_business_dates`.

## Metadata

`timezone`, `order_count`, `void_count`, `refund_batch_count`, `held_sales_unresolved` (jualan offline yang masih ditahan untuk pengurus ketika dibina; ia bukan dalam jurnal dan masuk hari ia diselesaikan), dan pilihan `adjusts_business_dates`, `sales_cents`, `reversal_cents`, `cash_variance_cents`. **Tiada data peribadi**: tiada nama pelanggan, telefon, nama kakitangan atau nombor resit. Medan tidak dikenali ditolak.

## Versi

`version` ialah 1. Ia hanya dinaikkan jika jurnal untuk hari yang sama tidak pernah diterima dan mesti diterbitkan semula dengan pembetulan. Jurnal yang sudah diterima tidak pernah diterbitkan semula (pembetulan ialah pelarasan hari berikutnya). Dasar ini perlu disahkan oleh Allurus.

## Pengangkutan (dibina di possaas; Allurus membina penerima)

`POST` JSON (`Content-Type: application/json`) ke URL sambungan tenant, sebuah titik akhir HTTPS (nama cadangan `receivePosJournal`). Tiada pengalihan diikuti.

Pengepala:

- `X-Timestamp`: saat unix ketika dihantar.
- `X-Idempotency-Key`: sama dengan `idempotency_key` dalam badan.
- `X-Signature`: HMAC-SHA256 (heks huruf kecil) bagi rentetan `"<X-Timestamp>.<badan mentah>"` dengan rahsia per tenant. Cap masa ada dalam tandatangan, jadi badan yang ditangkap tidak boleh dimainkan semula dengan masa baharu.

Penerima **mesti**: menolak cap masa lebih lima minit daripada jam sendiri (sama ada lama atau di hadapan), menolak tandatangan salah (bandingan masa tetap), dan menolak skema tidak sah.

**Badan** = jurnal seperti dalam skema ditambah `account_map`: peta kekunci akaun possaas (`cash`, `sales`, ...) kepada **pengecam akaun Allurus**, hanya bagi akaun yang digunakan jurnal itu (kunci tersusun, tiada kunci lebih atau kurang daripada akaun dalam `lines`, nama tidak kosong). Skema zod `journalWireSchema` dan [daily-journal.schema.json](daily-journal.schema.json) menerangkan badan penuh ini; jurnal yang dimeterai dan disimpan di possaas (`dailyJournalSchema`) belum mempunyai `account_map` kerana sender yang menambahnya. Peta disimpan dalam konfigurasi sambungan per tenant (`posIntegrations.accountMap`) dan **dibekukan pada percubaan pertama** bagi setiap jurnal, jadi percubaan semula menghantar bait yang sama. Akaun tanpa nama menghentikan penghantaran (dead letter) sehingga pemilik membetulkan peta dan menekan cuba semula.

**Nilai `account_map` ialah pengecam akaun yang legap** (contoh `acc_5f1c0a`): Allurus yang menentukan bentuk dan nilainya. Possaas tidak mentafsirnya, tidak menjana dan tidak mengesahkan format selain bukan kosong (had 80 aksara di sisi Allurus); ia hanya menyimpan dan menghantar semula nilai yang pemilik masukkan dalam skrin Integrasi. Ia bukan nama yang dipaparkan kepada pengguna.

**Allurus berkuasa ke atas peta.** Penerima membandingkan `account_map` dalam badan dengan `posIntegrations.accountMap` yang dipegang Allurus untuk tenant itu. Jika tidak sepadan (kunci atau nama berbeza, atau akaun yang digunakan tiada dalam peta Allurus), Allurus menjawab **422** dengan kod `account_map_mismatch` dan tidak merekod apa-apa. Possaas menganggap 422 sebagai dead letter (lihat di bawah); pemilik menyelaraskan peta di kedua-dua pihak, kemudian menekan cuba semula.

**`business_date`** ialah **tarikh pembukaan syif** dalam zon masa outlet (bukan tarikh jualan dibuat atau tarikh syif ditutup); lihat "Hari perniagaan" di atas.

**Kunci idempoten:**

- kunci baharu: terima dan simpan, jawab 2xx;
- kunci sama dan muatan sama: pulangkan entri sedia ada, jawab 2xx, tiada tulisan baharu;
- kunci sama dan muatan **berbeza**: jawab **409**, jangan timpa.

**Cara possaas menafsir jawapan:** 2xx = diterima. 409 = dead letter serta-merta, tidak dicuba lagi dan tidak ditimpa. 408, 425, 429, 5xx, tamat masa 10 saat dan ralat rangkaian = cuba semula dengan backoff 1 min, 2, 4, 8 ... maksimum 6 jam, dan dead letter selepas 8 percubaan. 4xx lain (400, 401, 403, 404, 422) = dead letter (biasanya konfigurasi); pemilik membetulkan dan menekan cuba semula. Isi jawapan tidak pernah dibaca atau disimpan; hanya kod ralat tetap direkodkan (`http_503`, `network_error`, `timeout`, ...).

**Rahsia:** pangkalan data hanya menyimpan nama rahsia (rujukan, contoh `ALLURUS_SECRET_ACME`). Nilainya diletakkan dalam pembolehubah persekitaran hos. Ia tidak pernah dalam repo, jadual, audit, log atau jawapan API. Putaran rahsia: tetapkan nilai baharu di kedua-dua pihak; pemilik boleh menukar nama rahsia untuk peralihan tanpa henti.

**Penyambung possaas (I6):** mod `allurus` menggunakan `AllurusAccounting` (`src/lib/integration/allurus.ts`), yang hanya memasukkan jurnal ke outbox (idempoten pada kunci; jurnal pertama dikekalkan). Penghantaran sebenar dibuat oleh sender dan titik akhir berjadual di bawah, jadi Allurus yang perlahan atau mati tidak menyekat kaunter atau penutupan syif. Ujian hujung ke hujung (`allurus.e2e.test.ts`) berjalan terhadap penerima tiruan yang mengikut `receive-pos-journal.md`: HMAC, cap masa, 201/200 idempoten, 409, 422 `account_map_mismatch`, cuba semula 5xx dan dead letter. Mod `standalone` tidak berubah.

**Pencetus:** titik akhir berjadual `/api/integration/dispatch` (lihat [dispatch.md](dispatch.md)); tiada proses latar dalam aplikasi.

## Soalan terbuka untuk Allurus dan CHEATDAY

1. Peta setiap kekunci akaun kepada akaun Finance Allurus (pembangun Allurus menetapkan; Allurus berkuasa, lihat `account_map_mismatch`).
2. Adakah Allurus ada dimensi outlet? Jika tidak, simpan `outlet_id` dalam metadata baris.
3. (Dijawab 2026-11-14: tarikh perniagaan ialah tarikh syif dibuka, jadi waktu potong tidak diperlukan.)
4. Dasar `version` di atas dan bentuk pengangkutan (badan, pengepala, 409): setuju?
5. Caj servis dan diskaun: tiada diskaun dalam produk lagi; caj servis mati secara lalai.
