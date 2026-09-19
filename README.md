# StockVoice

A small, mobile-first voice inventory MVP built with React, Vite, Tailwind, Express and MongoDB. Gemini extracts commands; deterministic server rules control all writes. No undo feature.

## 1. Run the demo immediately

Install **Node.js 22.12 or newer**. Open a terminal in this folder (the folder containing `package.json`).

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

On macOS/Linux, replace the copy command with `cp .env.example .env`.

Open **http://localhost:5173** and create an account. Before starting, add a random JWT_SECRET of at least 32 characters to .env (see the authentication section below). The frontend proxies API requests to Express on port 3001. Both processes start with one command. If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`.

For an offline demo, set `NODE_ENV=development`, `DEMO_MODE=true`, `HOST=127.0.0.1`, and `PORT=3001` in your local .env. This uses: an in-memory database, and a small English command parser. **Data resets on server restart.** Demo mode does not claim multilingual AI support. It accepts these exact command shapes (case-insensitive):

```text
add 5 kg Rice
remove 2 kg Rice
add 5 kg Rice at 65
check Rice
low stock
```

`at 65` explicitly sets the unit price to ₹65. Use singular unit names. Other sentences return a clarification error rather than guessing. Create your account, then add Rice or other products manually. Each account starts with an empty inventory.

## 2. Connect MongoDB and Gemini

Use a MongoDB Atlas cluster or a local MongoDB replica set. Transactions require a replica set; a plain standalone MongoDB server is intentionally rejected at startup. Atlas already supports transactions.

1. Create an Atlas database user with read/write access to the `stockvoice` database and permit your development machine in the cluster's network access list.
2. Put the connection string and Gemini key in your local `.env`:

```dotenv
DEMO_MODE=false
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_URL_ENCODED_PASSWORD@YOUR_CLUSTER/stockvoice?retryWrites=true&w=majority
MONGODB_DB=stockvoice
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-3.6-flash
```

3. Restart `npm run dev`. Live inventory starts empty. Click **New product**, enter Rice / 20 / kg / ₹60 / threshold 5, then review and confirm.
4. Try `Rice 5 kg add cheyyi`, `Rice 2 kg ammesanu`, `బియ్యం ఎంత ఉంది?`, or `తక్కువ స్టాక్ చూపించు`. Use a model available to your Google project that supports structured JSON output; `GEMINI_MODEL` is configurable.

Gemini receives the transcript and product names/units. The prompt supports English, Telugu, and Telugu-English speech; unambiguous aliases should map to the exact catalog name. The server accepts **only exact normalized catalog names**, so ambiguous AI matches fail safely. Test your actual spoken vocabulary with your chosen models before presenting.

### Optional local MongoDB with Docker

With Docker running, execute once:

```powershell
docker run -d --name stockvoice-mongo -p 127.0.0.1:27017:27017 -v stockvoice-data:/data/db mongo:8 --replSet rs0 --bind_ip_all
docker exec stockvoice-mongo mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

Wait a few seconds for the replica set to elect its primary. Set:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true
```

On future sessions use `docker start stockvoice-mongo`. The named volume retains data. This local database has no password and is bound to loopback for the demo.

## 3. Connect Gemini voice transcription

The installed `@google/genai` SDK uses `interactions.create` with inline audio and `gemini-3.5-transcribe`. Command understanding continues to use `gemini-3.6-flash`. Both use the same server-only Gemini API key.

```dotenv
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-3.6-flash
STT_MODEL=gemini-3.5-transcribe
HOST=127.0.0.1
PORT=3001
```

No separate transcription credential or base URL is required. Run `npm install` after extracting the project; `@google/genai` is already declared in package.json. To install it explicitly: `npm install @google/genai`.

Restart with Ctrl+C and `npm run dev`, then refresh http://127.0.0.1:5173. The microphone becomes available when the backend has both a Gemini key and a transcription model. This readiness check does not prove provider quota or model access.

1. In Chrome or Edge on localhost, allow microphone access.
2. Choose Auto for English/Telugu mixed speech, or English/Telugu for a language hint.
3. Tap the microphone, speak, and tap stop. Recording stops at 60 seconds; uploads are limited to 12 MB.
4. Review/edit the transcript and click Review command.
5. Additions/removals require Confirm or Cancel; queries only show results.

The browser sends audio to `/api/transcribe`. The backend sends base64 audio to Gemini using the SDK, verbatim mode and unit vocabulary hints. It reads `output_text`; it does not ask the transcription model to execute commands. English, Telugu, and code-switching accuracy still need to be checked with actual recordings. Raw audio is not saved locally or uploaded to the Files API; the interaction requests `store: false`. Provider data policies still apply. Errors are logged with the key redacted and a clean message is shown in the app.

With Rice already in your catalog, try each recording separately:
- “Add 5 kg rice” — ADD_STOCK, 5 kg, confirmation required.
- “Rice 5 kg add cheyyi” — ADD_STOCK, 5 kg, confirmation required.
- “Rice rendu kg ammesanu” — REMOVE_STOCK, 2 kg, confirmation required.
- “Rice entha undi?” — CHECK_STOCK, no confirmation.
- “Low stock items enti?” — LOW_STOCK, no confirmation.

Demo mode can transcribe when Gemini is configured, but still uses the limited English demo parser for command understanding. Use `DEMO_MODE=false` for multilingual command extraction and MongoDB.

## Safety and behavior

- Intents: `ADD_STOCK`, `REMOVE_STOCK`, `CHECK_STOCK`, `LOW_STOCK`, `UNKNOWN`.
- Units: `piece`, `kg`, `litre`, `bag`, `dozen`. No automatic unit conversions. Piece/bag/dozen quantities and thresholds must be whole numbers; kg/litre allow up to three decimals.
- All numeric fields must be finite, nonnegative and at most 1,000,000. Stock changes require a quantity greater than zero. Resulting stock cannot be negative or exceed 1,000,000.
- Unit price is optional for additions: omitted price keeps the current value. To change a price during a removal, edit the product separately. Manual creation requires quantity, unit price and low-stock threshold (zero is allowed).
- Unknown products are never silently created by AI. Create them manually first. Product names are unique after Unicode/case/whitespace normalization. Units cannot be edited after creation.
- Manual create/edit/delete also require review and confirmation. Deletes preserve the audit history.
- The backend stores the proposed action. Confirm accepts only its random ID; it never trusts a replacement action from the client. Pending actions expire in five minutes and are bound to a browser cookie. Cancel deletes the pending action.
- Product versions reject stale previews. Confirmations are single-use. MongoDB transactions commit the product update, history entry and confirmation consumption together, including during concurrent requests.
- Every successful change records its type, product, before/after quantity, old/new unit price, original transcript (or a manual-action label), and timestamp. The dashboard shows the latest 50 entries; MongoDB retains all entries.
- Low stock means quantity **less than or equal to** its product threshold. Inventory value uses current unit price, not historical costing.
- AI and audio calls have timeouts; validation, quota, configuration and transcription failures show actionable messages. Provider failures never fall back silently to demo mode.

## Verification

```powershell
npm test
npm run build
```

The automated suite covers preview/cancel, single-use confirmation, simultaneous removals, stale and expired previews, browser ownership, stock/price/unit validation, manual CRUD, read-only queries, malformed Gemini output, structured-output requests and Gemini transcription configuration, formats, readiness, sanitized errors and mocked multilingual flows. These tests use the in-memory store and mocked providers; they do not prove your credentials, live model accuracy, or MongoDB connectivity.

To serve the built frontend and API from one local process:

```powershell
npm run build
npm start
```

Open **http://localhost:3001**. `.env` is read from the project directory, so run commands there. Leave `PORT=3001` for development because the Vite proxy targets that port.

### Live smoke check before the hackathon

With your configured MongoDB and providers: create Rice; add and confirm 5 kg; refresh and restart to verify persistence; remove too much and verify rejection; cancel a change and verify unchanged stock; submit English/Telugu/mixed speech and inspect the extracted transcript; verify each successful change in recent activity.

## Two-minute demo sequence

1. Show the dashboard: your account and its inventory (create sample products beforehand).
2. Type `add 5 kg Rice`. Point out **42 → 47 kg**. Cancel once; stock stays 42.
3. Submit again and confirm. Inventory becomes 47 and the original text appears in recent activity.
4. Type `remove 100 kg Rice`. Show the insufficient-stock error; stock remains 47.
5. Type `check Rice`, then `low stock`. These queries make no changes.
6. Add a new product manually, review and confirm. Edit its threshold or price and confirm.
7. In configured live mode, record `Rice 2 kg ammesanu`. Review the transcript and confirm the removal.

## Project structure

```text
src/main.jsx                 Dashboard, CRUD forms, recording and confirmation UI
src/style.css                Responsive styles and Tailwind import
server/app.js                API routes and confirmation flow
server/rules.js              Strict schemas and deterministic business rules
server/store.js              In-memory store and transactional MongoDB adapter
server/services/intent.js    Offline parser and Gemini structured JSON extraction
server/services/stt.js       Gemini Interactions transcription adapter
server/tests/app.test.js     Automated safety and adapter tests
```

## MVP boundaries

This is a hackathon app with authenticated, per-user inventory. Development defaults to 127.0.0.1; production defaults to 0.0.0.0 and accepts same-domain requests. Public deployment requires HTTPS. Mobile layouts work at narrow screen sizes; phone microphone access requires HTTPS.

For simplicity the MongoDB adapter loads the small store into memory per operation, compares changes, then commits only changed records in a transaction. This suits a hackathon inventory, not a large production catalog. Restarting demo mode discards all demo state; live state and pending confirmations persist in MongoDB. There is no undo, no sales accounting, no unit conversion, and no offline speech model bundled.

API reference: [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Gemini transcription API](https://ai.google.dev/gemini-api/docs/transcribe).



## Reliable AI requests and browser voice replies

Both Gemini command extraction and transcription retry only HTTP 429 or 503, with waits of 1, 2, and 4 seconds: one initial attempt plus at most three retries. SDK automatic transcription retries are disabled to keep that limit exact. Retries never wrap database writes. Exhaustion returns "AI service is temporarily unavailable. Please try again." Persistent quota exhaustion still requires available quota; retries do not replenish credits.

Browser speechSynthesis speaks query results, low-stock summaries, errors, cancellation and saved changes. Stock quantities come from backend query results or the committed transaction. Success is never spoken from a preview. Recording cancels previous speech to avoid recording the app's voice. Text replies remain available without speech support. Reply Language is independent of the input-language selector. English uses en-IN. Telugu uses deterministic Telugu response templates and te-IN; without an installed Telugu voice, the text remains Telugu and a non-blocking availability warning appears. The selection is never silently changed. Some browsers require a user gesture or block asynchronous speech, and voice availability varies by device.

No new packages are required for retries or voice replies. Keep the current GEMINI_API_KEY in .env; it is read only on the server and .env is gitignored. Required live settings: DEMO_MODE=false, HOST=127.0.0.1, PORT=3001, MONGODB_URI, MONGODB_DB=stockvoice, GEMINI_API_KEY, GEMINI_MODEL=gemini-3.6-flash, STT_MODEL=gemini-3.5-transcribe. Restart after editing environment values: Ctrl+C, then `npm run dev`.

Demo: create Rice with 12 kg; speak "Add 5 kg rice"; review and cancel once; repeat and confirm (17 kg); speak "Rice 2 kg ammesanu" and confirm (15 kg); ask "Rice entha undi?"; ask "Low stock items enti?"; request removal of 99999 kg and verify no confirmation or write. Check both the visible result and spoken response. Retry tests use simulated provider failures; multilingual flow tests mock provider responses, so they do not establish real-world recognition accuracy. Run `npm test` and `npm run build` locally.


## Accounts and independent reply languages

Install dependencies with `npm install` (new packages: bcryptjs and jsonwebtoken). Run frontend and backend with `npm run dev`. In a fresh download, copy `.env.example` to `.env`, then set all variables shown below. Do not replace an existing working .env.

```dotenv
DEMO_MODE=false
HOST=127.0.0.1
PORT=3001
MONGODB_URI=YOUR_EXISTING_CONNECTION_STRING
MONGODB_DB=stockvoice
GEMINI_API_KEY=YOUR_EXISTING_KEY
GEMINI_MODEL=gemini-3.6-flash
STT_MODEL=gemini-3.5-transcribe
JWT_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

For a new installation you can generate the JWT secret once (prints a new secret locally, not any existing credential):

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Store that generated value only in .env. The updated local workspace already has a generated JWT_SECRET; do not regenerate it on each restart. Changing it invalidates sessions. Secrets are never returned to the frontend, and .env remains ignored by Git.

Open `/signup`: enter a full name, unique username, email and matching password. Username is 3–32 characters using letters, numbers, dots, underscores or hyphens; it is normalized to lowercase. Email is lowercase and unique. Passwords require 8+ characters, a letter and a number, and are limited to 72 UTF-8 bytes to avoid bcrypt truncation. Successful signup logs you in. `/login` accepts username or email. Unauthenticated dashboard access redirects to `/login`; authenticated visitors to `/login` or `/signup` return to the dashboard.

Passwords are hashed using bcrypt (cost 10). JWTs expire after seven days and live only in HTTP-only, SameSite=Lax cookies. Production (`NODE_ENV=production`) cookies use Secure and require HTTPS. `/api/auth/me` verifies the token and account. Logout increments the user's session version so copied old tokens stop working; this signs out that user's other sessions too. Auth endpoints are rate limited. Every inventory and transcription endpoint requires authentication. MongoDB product names use a unique compound ownerId/nameKey index, allowing different users to each have Rice. Reads, writes, pending confirmations, history and the AI product catalog are scoped to the authenticated user; ownerId cannot be supplied by the frontend. Existing `price` handling is unchanged.

**OTP was not enabled because no email provider credentials were configured.** No SMTP host/user/password or Resend API key was present. Accounts have `emailVerified=false` and are allowed to log in for this MVP. This does not claim that emails have been verified.

### Existing inventory before accounts

Existing products and history without ownerId are preserved, but hidden from all accounts. They are deliberately not assigned to the first person signing up. After creating YOUR account, stop the app, then explicitly assign the old unowned inventory with:

```powershell
node server/assign-legacy.js YOUR_ACCOUNT_EMAIL --confirm
npm run dev
```

Run this from the project folder. It transfers only records without ownerId, never records belonging to another account. It does not copy stale confirmations. If a product name conflicts, the transaction rolls back: resolve the duplicate name before retrying. You can skip this command and start with a fresh inventory. Do not run it against an account that should not own the old stock.

### Two-account and language demo

1. Create account A at `/signup`. Add Rice with 12 kg, price 60, threshold 5, then confirm.
2. Set input to Auto, Reply Language to English. Say `Rice 5 kg add cheyyi`, review, confirm; hear 5 added and 17 current.
3. Change ONLY Reply Language to Telugu. Ask `Rice entha undi?`; see/hear Telugu with the stored quantity.
4. Keeping Reply Language on Telugu, ask `How much rice is available?`; response remains Telugu. Reload to verify the reply preference persists under `stockvoice_reply_language`.
5. Log out. Create account B with another username/email: its inventory and history must be empty. B may also create a product named Rice without affecting A.
6. Log out and log in as A; its Rice remains. Test incorrect password, duplicate email/username and a mismatched confirmation password.

Native speechSynthesis uses installed OS/browser voices. Telugu may not be installed and some browsers restrict asynchronous speech. The app still displays Telugu and attempts te-IN, shows a warning when no Telugu voice is found, and never changes your selection. Known grocery names and unit labels have small deterministic translations; unknown product names retain their catalog spelling. Input language remains dedicated to transcription, and output quantities always come from the backend. No external TTS service is used.

`npm test` includes separate users, ownership attacks, cookie flags, password hashing, duplicate accounts, invalid credentials, token expiry, logout revocation, all existing stock safeguards, retries and bilingual response templates. Tests use the in-memory repository and mocked AI; perform the live MongoDB and browser speech demo above on your machine as well.


## Deploy frontend and backend as one Node service

Use Node.js 22.12 or newer. Select the folder containing this package.json as the service root. Build with `npm install --include=dev && npm run build`; start with `npm start`. Build dependencies must be installed because Vite and Tailwind are devDependencies. Express serves dist and /api on the same domain, including refreshes of /login, /signup, and /dashboard. No separate frontend API URL is needed.

Set these hosting environment values (enter secrets only in the provider's environment settings):

```dotenv
NODE_ENV=production
DEMO_MODE=false
MONGODB_URI=<your Atlas connection secret>
MONGODB_DB=stockvoice
GEMINI_API_KEY=<your active key>
GEMINI_MODEL=gemini-3.6-flash
STT_PROVIDER=gemini
STT_MODEL=gemini-3.5-transcribe
JWT_SECRET=<a stable random secret of at least 32 characters>
```

Leave HOST unset (defaults to 0.0.0.0 in production) and let the provider supply PORT. If HOST is required, use 0.0.0.0. Do not upload your local .env or copy its local HOST/PORT settings to hosting. Keep NODE_ENV=development for local npm run dev; the production template is not an offline demo configuration.

In Atlas Network Access, allow your hosting service's outbound addresses. For a temporary hackathon you can allow 0.0.0.0/0, which permits connections from any IP; restrict it to the hosting addresses when possible. The database still requires its credentials. No Atlas settings are changed by this project.

Production uses Secure, HTTP-only, SameSite=Lax authentication cookies and therefore requires HTTPS for browser login. The app trusts one reverse proxy, suitable for a single hosting ingress; adjust that setting if your deployment uses a different proxy topology. Gemini and MongoDB secrets stay on the server. Microphone access requires HTTPS and user permission; installed browser/OS voices determine Telugu speech availability.

After deployment: open /signup, create an account, add Rice manually and confirm; add 5 kg by text and confirm; refresh to check persistence; test microphone input and both reply languages; log out and sign in with a second account to check isolation. Test a removal larger than stock and verify it is rejected. AI quota and actual device microphone/voice support require a live smoke test.
