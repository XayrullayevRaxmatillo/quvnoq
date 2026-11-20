# UZUZ — Bilim — kuch. Jamoa — g‘alaba.

Bepul, ko‘p tilli (UZ / RU / EN), real-time multiplayer quiz platformasi.

Loyiha ikkita **mustaqil** qismga ajratilgan — har biri o‘z `package.json`, `node_modules` va `.env` fayliga ega:

```
uzuz/
  backend/    NestJS API + Socket.IO gateway + MongoDB (Mongoose) + o‘yin dvigateli + seed
  frontend/   React 18 + Vite + Tailwind ilova (barcha sahifalar, o‘yin ekranlari, admin panel)
  API.md      REST va Socket.IO hujjati (endpointlar o‘zgarmagan)
  render.yaml Render blueprint (faqat backend)
```

- **Backend:** Node.js 20+, **NestJS 11** (Express platformasi), TypeScript, MongoDB + Mongoose, Socket.IO (`@nestjs/websockets`), Zod, helmet
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Router, Motion, i18next, Socket.IO client, Zod

Umumiy kod (Zod sxemalar, socket tiplari, ochko hisoblash, matching) endi har bir qismning ichida:
`backend/src/shared/` va `frontend/src/shared/`. Bitta faylni o‘zgartirsangiz, ikkinchisiga ham nusxa ko‘chiring.

---

## 1. Lokal ishga tushirish

**Talablar:** Node.js 20+ va npm. MongoDB o‘rnatish shart emas — `MONGODB_URI` bo‘sh bo‘lsa, backend
ichki MongoDB'ni o‘zi ishga tushiradi (ma’lumotlar `backend/.mongo-data` da, birinchi marta ~100 MB yuklab olinadi).

**1-terminal — backend:**

```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env   (.env allaqachon bor bo‘lsa, shart emas)
npm run dev                 # http://localhost:4000
```

**2-terminal — frontend:**

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Saytni http://localhost:5173 da oching. Vite `/api` va `/socket.io` so‘rovlarini `http://localhost:4000` ga
proxy qiladi, shuning uchun lokal ishlashda `VITE_API_URL` bo‘sh qoladi va cookie'lar muammosiz ishlaydi.

Tekshirish: http://localhost:4000/health → `{"ok":true,"db":true,...}`

### Backend buyruqlari (`backend/` ichida)

| Buyruq | Vazifasi |
|---|---|
| `npm run dev` | NestJS'ni watch rejimida ishga tushiradi (tsx) |
| `npm run build` | TypeScript → `dist/` |
| `npm start` | Production: `node dist/main.js` |
| `npm run seed` | Kategoriya va rasmiy viktorinalarni qo‘shadi (`-- --reset` — qayta yaratadi) |
| `npm run admin:create -- <login> <parol>` | Admin yaratish / parolini yangilash |
| `npm test` | Unit (o‘yin dvigateli, scoring, sxemalar) + integratsion test (NestJS + Socket.IO + ichki MongoDB) |
| `npm run typecheck` | TypeScript tekshiruvi |

### Frontend buyruqlari (`frontend/` ichida)

| Buyruq | Vazifasi |
|---|---|
| `npm run dev` | Vite dev server (5173) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Build’ni lokal ko‘rish |
| `npm run typecheck` | TypeScript tekshiruvi |

### Admin panel

`/admin` sahifasi. Birinchi adminni yaratish: `backend/.env` da `ADMIN_USERNAME` va `ADMIN_PASSWORD`
(kamida 10 belgi) ni to‘ldiring yoki `npm run admin:create -- <login> <parol>`.

---

## 2. Backend tuzilishi (NestJS)

```
backend/src/
  main.ts                    kirish nuqtasi (listen)
  app.factory.ts             helmet, CORS, cookie-parser, JSON limit, /api/v1 prefix, Socket.IO adapter
  app.module.ts              barcha modullar + global guard/filter + SessionMiddleware
  common/
    filters/                 AllExceptionsFilter → { error: { code, message } } formati
    guards/admin.guard.ts    admin cookie tekshiruvi
    middleware/              mehmon sessiyasi (uzuz_sid cookie)
    pipes/                   ZodValidationPipe (sxemalar frontend bilan umumiy)
    rate-limit/              @ActionLimit / @IpLimit + global 400 so‘rov/daqiqa limiti
    decorators/              @Guest(), @CurrentAdmin()
  database/                  MongoDB ulanish, seed, birinchi admin (lifecycle hook’lar)
  realtime/                  GameGateway (Socket.IO), RealtimeService (bildirishnomalar)
  game/                      o‘yin dvigateli (GameRoom) va GameManager
  modules/
    session/ quizzes/ rooms/ teams/ leaderboard/ images/ reports/ admin/ health/
                             har birida *.controller.ts + *.service.ts + *.module.ts
  models/                    Mongoose modellari
  seed/  scripts/  shared/  utils/  config/
```

Barcha REST endpointlar, javob formatlari, status kodlari, cookie’lar va Socket.IO eventlari
avvalgi Express versiyasi bilan **bir xil** — frontend kodida API bo‘yicha hech narsa o‘zgarmadi.

---

## 3. Deploy (frontend va backend alohida)

> ⚠️ Vercel serverless WebSocket'ni ushlab turolmaydi — backend doimiy ishlaydigan Node jarayonida bo‘lishi kerak
> (Render / Railway / Fly.io / VPS).

### MongoDB Atlas

1. https://cloud.mongodb.com da bepul M0 klaster yarating.
2. *Database Access* — foydalanuvchi qo‘shing, *Network Access* — `0.0.0.0/0` (yoki hosting IP’lari).
3. Connection string: `mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/uzuz`

### Backend → Render

- Repoda `render.yaml` bor: Render → *New → Blueprint*. Yoki qo‘lda *Web Service*:
  Root Directory = `backend`, Build = `npm install --include=dev && npm run build`, Start = `npm start`, Health check = `/health`.
- Environment:
  `NODE_ENV=production`, `MONGODB_URI=...`, `CLIENT_URL=https://<vercel-domeningiz>`,
  `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `TRUST_PROXY=1`, ixtiyoriy `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
- Docker: `cd backend && docker build -t uzuz-backend . && docker run -p 4000:4000 --env-file .env uzuz-backend`

### Frontend → Vercel

- Root Directory = `frontend`, Framework = Vite, Build = `npm run build`, Output = `dist`.
- Environment: `VITE_API_URL=https://<render-backend-domeningiz>` (oxirida `/` bo‘lmasin).
- `frontend/vercel.json` SPA yo‘naltirishlarini sozlaydi.

> Brauzerlar boshqa domendagi (third-party) cookie'larni tobora ko‘proq bloklamoqda (ayniqsa Safari).
> Eng ishonchli variant — backendni frontend domenining subdomeniga qo‘yish: `uzuz.uz` + `api.uzuz.uz`.

### Backend environment (`backend/.env`)

| O‘zgaruvchi | Ta’rif |
|---|---|
| `PORT` | Server porti (standart 4000) |
| `NODE_ENV` | `development` / `production` |
| `MONGODB_URI` | Ulanish satri. Dev’da bo‘sh bo‘lsa ichki MongoDB. Production’da majburiy |
| `CLIENT_URL` | Ruxsat etilgan frontend manzil(lar)i, vergul bilan (CORS va Socket.IO) |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | Cookie sozlamalari (`none` bo‘lsa `secure=true` majburiy) |
| `TRUST_PROXY` | Proksilar soni (Render/Railway/Fly = 1) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin hali bo‘lmasa, ishga tushishda yaratiladi |

Backend ishga tushishda env’ni Zod bilan tekshiradi va xato bo‘lsa ishga tushmaydi.

---

## 4. Nimalar tayyor

**O‘yin (Arena)**
- Xona yaratish (klassik / jamoaviy / yakka), 6 belgili xavfsiz kod (0/O/1/I harflarisiz, `crypto.randomInt`), havola va QR kod
- Lobby: o‘yinchilar real vaqtda ko‘rinadi, kick qilish, xonani qulflash, ochiq xonalar ro‘yxati
- Server boshqaradigan bosqichlar: COUNTDOWN → QUESTION → REVEAL → LEADERBOARD → FINISHED
- Taymer server vaqti (`endsAt`) va soat sinxronizatsiyasi asosida ishlaydi; kech javoblar (300 ms grace'dan keyin) rad etiladi
- Ochko faqat serverda hisoblanadi (tezlik + seriya bonusi), to‘g‘ri javob REVEAL bosqichigacha klientga yuborilmaydi
- Takroriy va soxta javoblar rad etiladi (bosqich, savol indeksi, vaqt va a’zolik tekshiriladi)
- Qayta ulanish: sahifani yangilash yoki internet uzilishidan keyin o‘yinchi o‘z o‘rni va ochkosiga qaytadi
- Boshlovchi uzilsa, o‘yin avtomatik davom etadi; qaytib kelsa, boshqaruv yana unga o‘tadi
- Yakuniy podium, konfetti, natijalarni ulashish sahifasi, "Yana o‘ynash"

**Jamoalar:** qidirish va filtrlar, yaratish, darhol qo‘shilish, tasdiq bilan qo‘shilish (real vaqt bildirishnomasi),
yopiq jamoalar va taklif kodi/havolasi, chiqish, egalikni o‘tkazish, kick, "Menga mos jamoa top" algoritmi
(fan 40% + til 25% + daraja 20% + bo‘sh joy/faollik 15%), sig‘im atomik tekshiriladi, ko‘pi bilan 3 ta jamoa,
jamoaviy o‘yin rejimi.

**Viktorina yaratish:** variantli va to‘g‘ri/noto‘g‘ri savollar, rasm yuklash (brauzerda siqiladi, EXIF o‘chiriladi,
serverda turi tekshiriladi), izoh, vaqt va ball rejimi, sudrab tartiblash, nusxa olish, tezkor tugmalar, o‘yinchi
ko‘rinishida oldindan ko‘rish, JSON import, lokal qoralama (autosave), nashr qilish, bir martalik tahrirlash kaliti.

**Kutubxona:** 7 kategoriya, qidiruv, filtrlar, saralash, sevimlilar (brauzerda saqlanadi), viktorina sahifasi
va uning eng yaxshi natijalari, shikoyat qilish.

**Reyting va geymifikatsiya:** umumiy, haftalik (Toshkent vaqti bilan dushanba 00:00 dan) va jamoalar reytingi;
XP, darajalar, 7 ta nishon, shaxsiy statistika va o‘yinlar tarixi. Kunlik XP limiti bor. XP faqat 3+ o‘yinchili
yoki to‘liq yakunlangan yakka o‘yinlardan beriladi. Reytingdan yashirinish mumkin.

**Xavfsizlik:** httpOnly cookie, xeshlangan tokenlar, sessiyani tiklash kodi (tokenni almashtiradi), helmet va CSP,
CORS, IP va sessiya bo‘yicha rate limit, socket eventlar throttling'i, barcha HTTP va socket kiritmalari uchun Zod,
taxallus va nomlar uchun so‘kinish filtri, alohida himoyalangan admin (bcrypt, rate-limitli login, audit jurnali).

**UX:** UZ/RU/EN to‘liq tarjima (570 kalit), tungi va kunduzgi rejim, harakatni kamaytirish rejimi
(OS sozlamasi + qo‘lda), ovoz effektlari (WebAudio, original), klaviatura bilan o‘ynash (1–4), ARIA live,
fokus ko‘rsatkichlari, 360px dan boshlab moslashuvchan dizayn, PWA manifest va oflayn sahifa.

## 4. Hali qilinmagan / cheklovlar

Bular ataylab soxta tugma bilan almashtirilmagan:

- **Admin uchun TOTP 2FA** — yo‘q (login rate-limit va bcrypt bor).
- **Taxalluslar uchun admin blocklist UI** — yo‘q. Haqoratli taxalluslar shikoyat orqali yashiriladi; so‘kinishlar ro‘yxati `backend/src/shared/profanity.ts` (frontend nusxasi: `frontend/src/shared/`) da.
- **Ko‘p server instansiyasi:** o‘yin holati bitta jarayon xotirasida. Bir nechta instansiya uchun `@socket.io/redis-adapter` va "sticky session" kerak. Server qayta ishga tushsa, davom etayotgan o‘yinlar yopiladi (yakunlangan natijalar MongoDB'da qoladi).
- **Rasm saqlash:** rasmlar MongoDB'da saqlanadi (≤512 KB, avval siqiladi). Katta trafik uchun Cloudinary/S3 ga ko‘chirish tavsiya etiladi.
- **Savol turlari v2:** bir nechta to‘g‘ri javob, javobni yozish, tartiblash — keyingi bosqich.
- **Playwright end-to-end testlari** repoga kiritilmagan. Unit va socket integratsion testlari bor.
- Seed: har bir kategoriya bo‘yicha 3 tadan viktorina (jami 21). `backend/src/seed/data.ts` ga osongina qo‘shish mumkin.

## 5. Testlar

```bash
npm test
```

- `backend/test/shared.test.ts` — ochko formulasi, seriya bonusi, XP/daraja, matching, xona kodlari, slug, sxemalar, so‘kinish filtri
- `backend/test/engine.test.ts` — to‘liq o‘yin, kick/lock/sig‘im, qayta ulanish, lobby tozalash, boshlovchi uzilishi, yakka va jamoaviy rejimlar, javoblarni aralashtirish
- `backend/test/integration.test.ts` — haqiqiy NestJS + Socket.IO + ichki MongoDB, 3 ta o‘yinchi va boshlovchi

## 6. Litsenziya va brending

Nom, logo, avatarlar, ikonalar va ovozlar UZUZ uchun original tarzda yaratilgan.
Kahoot yoki boshqa brendlarning dizayni, logosi va matnlaridan foydalanilmagan.
