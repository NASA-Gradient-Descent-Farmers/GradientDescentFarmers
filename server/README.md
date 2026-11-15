# YolIA on WhatsApp: Twilio Sandbox webhook

A farmer writes to our Twilio WhatsApp Sandbox number; this server answers with the **same conversation engine as the
web simulator** (`frontend/src/whatsapp/engine.ts`), on the same precomputed results (`frontend/public/data`). Nothing is
re-implemented: the server only adds what a text channel needs (numbered answers, message splitting, the link to the website).

This is the local/testing phase: no deployment, no production WhatsApp number. Conversations are kept in memory and are
lost when the server restarts.

```
phone ──WhatsApp──▶ Twilio ──HTTPS POST /whatsapp──▶ tunnel ──▶ this server ──▶ shared engine ──▶ TwiML reply
```

## What it answers

- **Locations** (defined once in `frontend/src/lib/demoLocations.ts`): Guanajuato (20.4243195, -101.1466639), Sinaloa
  (25.7636111, -108.8613889) and Sonora (27.332202, -110.162783). Name one in a message, or answer with 1, 2 or 3.
  They are demonstration reference points, not verified parcels.
- **Guanajuato** answers use the bundled model results, which were computed at El Batán, Texcoco, and are **not
  calibrated for Guanajuato**. Every such answer is labelled *"Datos experimentales de demostración"*. No answer is
  ever presented as validated.
- **Sinaloa and Sonora** answer from the rotations service's published runs (`mexico_norte_01` and `mexico_norte_02`,
  see `gradientdescentfarmers/rotations_service/README.md`), read from `frontend/public/data/rotations/`. They are
  exploratory scenarios: a crop model on 2024–2025 weather with historical SIAP prices, low confidence, not validated in
  the field. Income is always *gross per hectare* over the whole plan, never profit, and "sin datos" is never zero. If a
  location's file is missing or fails its check the bot says *"Datos no disponibles"* for it and never reuses another
  location's results. To refresh them, see *Updating the rotation results* in `frontend/README.md`.
- Every figure comes from the stored model results; nothing is estimated or written by hand.
- Send `menu` at any time to start over. Photos and voice notes are not read.

## Requirements

Node 22.6 or newer (it runs the TypeScript directly), and `npm`. Install once:

```bash
cd frontend && npm ci && cd ../server && npm ci
```

## 1. Create a Twilio account

1. Sign up at <https://www.twilio.com/try-twilio> and verify your email and phone number.
2. In the Twilio Console, copy your **Auth Token** (Console home → *Account Info*; click to reveal). It is only used
   to check that requests really come from Twilio. Treat it like a password: never commit it or paste it in chat.

## 2. Activate the WhatsApp Sandbox

1. In the Console go to **Messaging → Try it out → Send a WhatsApp message** (the menu names can shift; search the
   Console for "WhatsApp sandbox").
2. The page shows the Sandbox number (usually `+1 415 523 8886`) and a join code such as `join word-word`.

## 3. Join the Sandbox from your phone

From each phone that will test, open WhatsApp and send the join message (`join word-word`) to the Sandbox number.
Twilio confirms. Each tester must do this once; the Sandbox membership expires after about 72 hours of inactivity,
and then you send the join message again.

## 4. Start the server and a tunnel

```bash
cd server
cp .env.example .env        # then fill in TWILIO_AUTH_TOKEN (and PUBLIC_WEBHOOK_URL after the next step)
npm start                   # listens on http://localhost:3000
```

In another terminal, open a temporary HTTPS tunnel to port 3000, with either tool:

```bash
ngrok http 3000                                   # https://ngrok.com
cloudflared tunnel --url http://localhost:3000    # https://github.com/cloudflare/cloudflared
```

Copy the `https://…` address it prints. Put it in `server/.env` as
`PUBLIC_WEBHOOK_URL=https://<your-tunnel-address>/whatsapp` (note the `/whatsapp` at the end) and restart `npm start`.
**The URL must match what Twilio calls exactly**, because the signature check is computed over it. Free tunnels give
a new address every time they restart, so repeat this step (and step 5) then.

## 5. Point Twilio at the webhook

In the Console, **Messaging → Try it out → Send a WhatsApp message → Sandbox settings**:

- *When a message comes in*: `https://<your-tunnel-address>/whatsapp`
- Method: `POST`. Save.

## 6. Test a full conversation

Message the Sandbox number from your phone, for example:

| You | YolIA |
| --- | --- |
| `Hola` | Welcome, and the three locations as a numbered list |
| `1` | Location: Guanajuato (coordinates), marked as experimental demonstration data |
| `¿Qué me conviene sembrar?` | Asks what you planted, one question at a time (answer with the number or in words) |
| `1`, `3 hectáreas`, `solo lluvia`, `1` | Recommendation from the stored model results, with its reliability and the website link |
| `¿Y si llueve poco?` / `¿Cuánto podría ganar?` | Answers from the same results, without asking again |
| `Sonora` then `¿Qué me conviene sembrar?` | The rotation options for Sonora (with and without irrigation), gross income per hectare, the confidence caveats and the website link |
| `¿Cuánto podría cosechar?` / `¿Qué pasa si llueve poco?` | Simulated grain per crop and season; irrigated against rain-only income |

Check `GET http://localhost:3000/health` returns `ok`. If WhatsApp gets no reply, look at the server terminal: a
`rejected a request with a missing or invalid Twilio signature` line means `PUBLIC_WEBHOOK_URL` or the Auth Token
does not match the Console.

## Configuration (`.env`, never committed)

See `.env.example`: `TWILIO_AUTH_TOKEN` and `PUBLIC_WEBHOOK_URL` are required; `PORT`, `YOLIA_SITE_URL` (the website
linked in replies) and `SESSION_MINUTES` are optional. Logs never contain message text or full phone numbers.

## Tests

```bash
cd server && npm test && npm run typecheck
```

They run the webhook over real local HTTP with requests signed by the official Twilio SDK, and need no network or
credentials: signature checks, incoming messages, multi-turn conversations, location recognition, and missing data.
The web simulator's tests are in `frontend` (`npm test`).
