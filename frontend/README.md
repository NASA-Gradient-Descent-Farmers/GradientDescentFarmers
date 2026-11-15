# YolIA

**YolIA** (a play on words: *Yol* + *IA*, inteligencia artificial; it was called Campo Verde, whose name survives in a few storage keys and old style names) is a static React + TypeScript + Vite web app for farmers and advisors in Texcoco, built on the model results of the NASA Gradient Descent Farmers project. Spanish first (English on a toggle). This folder is the web app only.

The planner reads small JSON files exported from the Python outputs (committed in `public/data/`), so it runs without Python or PCSE, and nothing in the browser re-runs a crop model. The map and the NASA climate check are the exception: they need internet (map tiles and NASA's climate service).

## Status

The app has two modes, chosen when an account is created: **Agricultor** (a short guided start, then one simple page with an embedded assistant, in plain Spanish) and **Técnico** (the full crop-planning tools and the models' numbers). Today it runs entirely in the browser on exported results, with simulated accounts (no password, no server). Connecting it to the Python backend API of this repository, real accounts and the planned WhatsApp assistant are future work; the account layer (`src/account/`) and the assistant backend seam (`src/assistant/backend.ts`) are where they plug in.

## Look and flow

YolIA has **two modes in one app**: **Agricultor** (a short guided start, then one simple page with the assistant, for a farmer who may never have used a planning app) and **Técnico** (the full planner and the assistant that cites the model behind every number, plus the guided pages and the full recommendation card). Both read the same exported results, so the science is the same. Which mode a person uses belongs to their account (below); the account menu switches it.

### Design system (`src/theme.css`, `src/index.css`)

Orange, black and white. **Orange** is the wordmark's colour and means "you can act on this" (buttons, the selected answer, links); **black** is text, outlines and navigation; **white** is the page, with light grays only for borders and quiet surfaces. Green is not used for the interface any more (the old Campo Verde greens are remapped to these three; `theme.css` keeps the old token names working so the Técnico pages follow). Red and amber appear only for real warnings and errors, always with an icon and words, and colour never carries a meaning alone: a selected answer also has a tick, an estimate also says "estimado", confidence is a four-step meter *and* a word. Body text is 17 px, touch targets are at least 48 px, the layout is built for 360 px first (one column) and stays a centred column on wide screens. Contrast was computed, not eyeballed: orange text and white-on-orange buttons use `--orange-600` (5.5:1); the lighter wordmark orange (4.4:1) is used for the logo and large shapes only. The app is light only, because it is read outdoors. Animation is limited to short colour changes.

### Accounts (simulated) (`src/account/`, `src/screens/SignInScreen.tsx`)

The front page is the sign-in: "¡Hola! Bienvenido a YolIA.", the accounts on this phone to pick from, and "Crear una cuenta" (a name, and Agricultor or Técnico). **This is a simulation to tell users apart now and to be replaced by real accounts later: there is no password and no server**, and the screen says so. No password or credential is asked for or stored.

- `account/users.ts` holds the pure rules (a tidied name, no two accounts with the same name ignoring case and accents, at most 12 accounts, stored text is validated and anything odd is dropped) and is tested. `AccountProvider` keeps who is signed in (`yolia-accounts`, `yolia-session`, so a reload does not sign anyone out) and the **seam for real accounts**: everything that needs "who is this" goes through `useAccount()` (`user`, `signIn`, `signUp`, `signOut`, `setMode`, `remove`), never through storage.
- **Each account has its own saved data.** `account/storage.ts` gives every saving module its key through `scopedKey(...)` (`yolia:<account id>:<name>`): the parcel and answers, the chat, saved recommendations, the pin and the Técnico conversations. Signing in points them at that account before the app is drawn, and the app is keyed by account and mode, so it starts afresh for each. Removing an account deletes its keys. The language is shared by the phone. Data saved before accounts existed is not migrated.
- The badge with the person's initial in the top bar opens a small menu: switch mode (Agricultor ↔ Técnico; a convenience while this is a simulation) and sign out.

### Agricultor: a guided start, then one page (`src/farmer/ui/FarmerHome.tsx`)

The question the app answers is *"¿Qué me conviene sembrar en mi parcela para la próxima temporada?"*.

- **First time** (an account with no parcel or answers): a welcome line and **Mi parcela**, one question per screen with a progress bar and an explicit "Continuar": where the parcel is (search a municipality, use the phone's location, or mark the map; no coordinates are ever asked for), what was planted last season, how many hectares, rain or irrigation, and what matters most (earn more, lower risks, look after the soil), ending in a summary with a "Cambiar" on each row. Finishing it brings the person to the home page, which asks the question for them and shows the recommendation.
- **After that**: one page, no menu bar. A line with the parcel and the answers ("Texcoco, Estado de México · 2 ha · Solo de la lluvia · Reducir riesgos") with "Cambiar mis datos" (which reopens the guided questions), then the assistant: a chat with suggested questions, a large input, an obvious "Enviar" and a microphone where the browser supports speech. When something is missing the assistant asks for it in the chat with answer buttons. The recommendation arrives in the chat as a **brief card** (the crop or rotation, which crop it would be this season, one figure for the farmer's hectares, the main risk, how sure it is) with "Ver todos los detalles" for the rest.

### Técnico: the parcel tools (`src/farmer/ui/ParcelTools.tsx`)

The fuller pages built for the first-time journey live in Técnico, under the **Por parcela** tab (next to *Asistente* and *Planificador*), with an inline bar: **Mi parcela** (the same guided questions), **Qué sembrar** (the full recommendation card: three stated estimates, what the model would do, the main risks, confidence with the evidence behind it, other options, how it was worked out, "Guardar esta recomendación") and **Mis recomendaciones** (what was saved, with the date, to reopen or remove). They read and write the same parcel and answers as the Agricultor home. The Técnico header is a single row (name, pin, account, language); the long model description shows only on wide screens.


**How the four answers reach the models** (`farmer/state.ts`, `farmer/recommend.ts`): hectares become the planner's area, rain or irrigation its water, and the goal its priority (earn → income, lower risk → steady, soil → soil). The crop of last season is *context only*: the rotation order maize → barley → faba bean gives "this season it would be X", and the card says that is the order of the rotation, not a model prediction. `recommend()` runs the browser planner and reads the stored rotation-risk rows; nothing is invented, and a rotation is never chosen by the text.

**Honesty rules, built into the screens.**
- Every figure is marked "≈ Estimado" and the card says it guarantees neither a harvest nor a profit. Losses are written as words ("pérdida de …"), not a minus sign.
- Confidence is never above "Baja": the crop model was fitted only to Texcoco and, in the calibration check, it did not pick which years were good or bad. "¿Por qué es baja?" shows that evidence, each line tagged *Dato observado* (from the data), *Estimación del modelo* or *Explicación general*.
- Coverage (`lib/coverage.ts`): inside the Texcoco zone the card is shown with a note; near it, it is a reference only; **outside**, no recommendation is given (neither in Qué sembrar nor in the chat), with an optional "see the Texcoco options as a reference". Being close to Texcoco is not treated as proof the model applies.
- Irrigation is not modelled: the card says the numbers are for rainfed parcels. Fertilizer is shown as a reference from the model, "not tested in the field", with a pointer to a technician. Costs and the nitrogen price are the project's placeholders and are said to be provisional.
- Municipality search uses `public/data/municipios.json`: 2,463 municipalities, each with an approximate centre (the median position of its rural localities in the INEGI catalogue, 2018 extract, taken from the project's municipality table; `municipios.json` is a one-off extract, committed, and is not regenerated). It is searched offline with accents and case ignored, and nothing is sent to a geocoder. The parcel is therefore a municipality or a map point, not a locality.

**The assistant is rules and templates, not a language model.** `farmer/chat.ts` classifies the question by keywords (plant, money, rain, trust, fertilizer), asks for what is missing, and answers with fixed Spanish wording around the model's numbers, so it can be tested without a browser. Technical words (WOFOST, NSGA, CVaR) do not appear in Agricultor; they stay in Técnico. The swappable backend seam in `src/assistant/backend.ts` is for the Técnico assistant; a real language model for Agricultor would plug in at `planReply` and must restate only numbers from the recommendation.

**Voice** (`farmer/speech.ts`) uses the browser's own speech recognition (es-MX or English), so audio goes to the browser vendor's service; the button is hidden when the browser has none. **Location** (`farmer/geolocate.ts`) asks for a low-accuracy fix, and a refusal or timeout ends in a plain message that offers the search and the map. The map is loaded only when opened (`components/LazyMapCard.tsx`), which keeps the first screens light on a slow connection; NASA POWER is sent the position rounded to 0.1° (about 11 km).

Older design files that are no longer routed were deleted (`WelcomeScreen`, `VersionScreen`, `LandingScreen`, `HomeSky`, `AnimatedWords`, the four-tab `FarmerApp`). `LeafTransition`, the leaf components and some old rules in `home.css` and `onboarding.css` remain and are safe to delete; `src/onboarding/` (the seven-question flow documented below) is also unreachable.


## Questions (no longer asked)

**These questions are not part of the app flow any more.** The Agricultor version goes from the pin to the assistant with nothing in between, so the assistant is told only the pin; what else it needs (crops, land, budget) is to be learned from the chat. The code and tests stay in `src/onboarding/` (the assistant still reads a saved profile through `farmInputs`, which is empty now, and hides the "change my answers" buttons when there is no way to open the questions); this section documents what they did.

The first time a farmer picks a card (all but "¿Qué tan cierto es el modelo?", which does not depend on the field), YolIA asks seven questions like an advisor, **one per screen** and only those it does not know yet: what to grow (any of maize, barley and faba bean, or "ayúdame a elegir"), where (the map, below), how much land (hectares, acres or m²), when to plant (a month and a third of it, "when the rains start", or a few words), the budget (pesos or dollars, ranges, or an amount), irrigation, and what matters most. Each screen has one prominent question, a short explanation, a native control (radios, checkboxes, fields; arrow keys and space work), suggestion chips beside the free-text fields and a clear Continue (Enter works too). Back keeps every answer, a quiet "Todavía no lo sé" skips a question that can wait, a progress bar counts only the questions left, and the language can be switched in the middle of a question without losing it. The last screen is an editable summary: every answer, a "Cambiar" for each and a line saying how the models will use it. Nothing is calculated until the farmer confirms.

**Adapting.** A saved pin skips the map question. The planting question shows NASA's average rain for each month at the pin. The budget question offers ranges built from the planner's own costs for the rotations that include the crops asked for, as totals for the land given (or per hectare if the area was skipped). A known profile skips the questions and goes straight to the assistant.

**No pretending to understand.** No language model reads what is typed. Each field accepts a small, stated grammar (a number with an optional unit, a month name in Spanish or English with "principios / mediados / finales", crop names from a short list; `src/onboarding/read.ts`) and, when it cannot place the words, asks **one focused follow-up** instead of guessing: a crop no model covers ("no tengo un modelo para trigo"), 500 hectares that may be 500 m², a month list ("junio o julio: ¿cuál se acerca más?"), a budget too small for the area ("¿para todo tu terreno o por hectárea?"). The decisions are in `src/onboarding/resolve.ts` and tested without a browser.

**How each answer reaches the models** (`src/lib/farm.ts`, `src/onboarding/profile.ts`; the inputs travel on the `Interpretation` as `farm`, so every answer records what it used):

| Answer | What the models get |
|---|---|
| Crops | The planner compares only the rotations that include every crop named (all four on "help me choose"), and builds its trade-off curve from them alone. A crop no model covers is kept, shown and left out. |
| Where | The pin: NASA climate and the coverage verdict, as before. |
| Land | Converted to hectares. Results stay per hectare; the guidance multiplies them for the total, to the hundred, and says it is a simple multiplication. |
| When | Not a model input: the crop model sows at the start of the rains (the first day, from each crop's earliest date, with 20 mm of rain in 5 days; after 45 days regardless; exported to `meta.json` as `sowing`). The answer is checked against that window for the crop it fits best, and "before" / "after" say the model's yields do not describe that date. |
| Budget | A ceiling on the mean yearly cost per hectare (other costs plus nitrogen at its price). The planner takes the Pareto front of the strategies under the ceiling (not the cheap part of the unlimited front), says which plan the budget replaced, and if nothing fits shows the cheapest and says so. Dollars use an editable rate that starts at 18 pesos per dollar and is labelled approximate. |
| Irrigation | Not a model input: every model here is rainfed. It is kept and each answer says the results describe the part of the land that depends on rain alone. |
| What matters most | Planner weights: income → profit first; soil → sustainability first; yield and steady income → half the weight on that objective, the rest shared evenly; spend less → the cheapest plan that keeps 90% of the best net income. "Save water" is not something the planner measures: it is weighed as steady income in bad years, the risk model is added with the low-rain scenarios, and the screen says so. |

**After the summary** the assistant answers the card question with those inputs and opens with "Tu plan, según tus respuestas": one line per answer saying what it did to the plan, each tagged *del planificador*, *tu respuesta frente al modelo* or *fuera de lo que cubren los modelos*, with the inputs used under "Qué entró a los modelos". A "Tu campo" card in the side panel lists the answers and reopens the summary, so they can be changed later; the answer is then asked again with the new ones. Answers live only in this browser (`campo-verde-profile`) and "Borrar mis respuestas" removes them and the pin.

## Where is your field?

In Agricultor the map opens from "Marcar en el mapa" in Mi parcela; the full-screen version opens from "cambiar" in the pin chip of the Técnico header. The farmer taps the map to drop a pin and drags it to adjust, uses their location, or taps one of the **predetermined places**.

The map opens on those places and draws each with the radius its data covers (25 km, the app's "inside" distance, `INSIDE_KM` in `src/lib/coverage.ts`):

| Place | Coordinates | What is published for it |
|---|---|---|
| Sonora | 27.332202, -110.162783 | environmental profile and rotation run |
| Sinaloa | 25.7636111, -108.8613889 | environmental profile and rotation run |
| Guanajuato | 20.4243195, -101.1466639 | environmental profile and rotation run |

They are defined once in `src/lib/demoLocations.ts`. Texcoco is not one of them and does not appear anywhere in picking a location. A pin always shows the data of the place it is in or nearest to (`zoneFor` in `src/lib/environment.ts`): inside the place's own 25 km the notice names it, farther away it says "you are seeing the nearest reference area" with the distance (`ZoneNotice`). The app never says it has no data, and never fills a place with results computed for another. `src/lib/locationFlow.test.ts` fails if the text of this flow names Texcoco again.

### What matters most, and the recommendation

The last of the guided questions is what matters most: **earn more**, **use water well** (it replaced "reduce risk"; an old saved answer is read as the new one) or **look after the soil**. The service already labels its options by objective (`highlight_objectives`: balance, income, water, soil, pesticide, tradeoff), so the option shown for a goal is the one the service itself picked for it (`pickForGoal` in `src/lib/rotations.ts`: income, water or soil; the highest priority score if several; the service's own balance pick when none is labelled). Nothing is ranked in the app. The regime the farmer says they have comes first, and both are always shown. The farmer's hectares and last crop do not change the results: the service computes per-hectare amounts and no area totals (`area_totals_computed: false`).

**Everything the service generated is shown for an option** (`optionLines` in `src/whatsapp/rotationAnswers.ts`, used by the web card, the in-app assistant and WhatsApp alike), following the UI contract of `gradientdescentfarmers/rotations_service/README.md`:

| README contract | Where |
|---|---|
| options separated by `water_regime`; `description_es`, `highlights_es` (word for word), `highlight_objectives` | the card and the chat |
| calendar by `planning_year` to `planning_year_end` and `sowing_month_day` to `calendar_end_month_day`; `historical_*` dates never shown | "año 1 nov → año 2 may" |
| `gross_median_mxn_ha` with P10/P90, per hectare over the whole horizon; null is "sin datos"; never net profit | highlight line and range line |
| applied irrigation (`irrigation_gross_m3_ha`) told apart from total use (`evapotranspiration_mm`); rain-only says it uses rain | water lines |
| `confidence.label_es` and its reasons; `priority_score` as affinity, never a success rate; soil index as a heuristic | "Afinidad … No es un porcentaje de éxito" |
| `advisory_status` (`high_risk_experiment`), `failed_harvests`, irrigation to confirm; nothing presented as an approved plan | status line on every option |
| `no_feasible_options`: the explanation, no invented recommendation | `noFeasible` |
| irrigation saving against the comparison reference, which is never the farmer's practice | "Usa 42 % menos riego que la opción factible de mayor ingreso" |

Figures are exact (to the peso), not rounded further. `src/farmer/ui/ZoneAnswer.test.tsx` checks these against the files. Nothing in the app answers from the old Texcoco planner in "Qué sembrar" or the assistant; Técnico keeps its dashboard (Asistente, Planificador, Por parcela), whose Planificador is the Texcoco-fitted tool and says so in its own model selector.

**Privacy.** The pin is stored only in this browser (`localStorage`). NASA POWER is sent the location rounded to 0.1° (about 11 km, finer than its weather cell, so nothing is lost), and the map tiles come from OpenStreetMap and NASA GIBS, which see the area being viewed. The page says this next to the map.

## Assistant

The Técnico assistant. Instead of four separate tools, the user asks in their own words and the assistant picks the project's models that the question needs, runs them, and explains what they returned. (The Agricultor assistant is the simpler one described above.)

**This is a demo assistant, and it says so on screen.** No language model or chat backend exists in this repo. Two things are therefore *not* done by an AI, and the interface labels both:

- *Reading the question* is keyword rules in Spanish and English (`src/assistant/interpret.ts`). What it understood (a price, a scenario, a crop model) is shown back as "Lo que entendí" chips, and a question it cannot place gets "No sé qué modelo usar para eso" and suggestions, never a guess.
- *The summary* ("En pocas palabras") is templates filled in with numbers from the results (`src/assistant/compose.ts`), each sentence tagged with the model it speaks for, or "Combinado" when it sets two models against each other (for example whether the risk model's bootstrap interval backs the planner's choice). It is captioned as written by a template. Every number in it comes from a model result shown on the same page.

There is no streaming (nothing here can stream), so while the models work the page shows the real state of each one (waiting, working, done, failed), not a typing effect.

| Model | Kind | What it runs | Needs |
|---|---|---|---|
| Strategy planner (NSGA + WOFOST) | computed in the browser | scores 4,284 strategies from `grid.json` (the port of the Python planner) | nothing |
| Climate (NASA POWER) | asked of NASA now | the pin's rain, temperature and coldest night against El Batán's | internet, the pin |
| Rotation risk and scenarios | saved results | paired-year bootstrap and Monte Carlo over WOFOST runs (`data/exploration/risk`) | nothing |
| SIAP calibration check | saved results | calibrated WOFOST against observed Texcoco yields, with two baselines (`calibration.json`) | nothing |
| Trees, forests, XGBoost and ensembles | saved results | holdout scores against simulated and observed yield | nothing |
| Reinforcement learning (CropGym) | not built | listed as planned, not usable | - |

The stored results come from `models.json`, exported from the project's modelling results, with the hash of every source file; the models panel shows each model's purpose, inputs, source and limits. Models can be chosen automatically from the question or picked by hand ("Elegir yo"); several can be combined, each answers on its own, and a combined statement is added only when both results exist. A model that fails (no pin, no connection) shows what happened and a retry for that model alone, the other results stay, and the question is kept. Conversations are saved in this browser only (20 conversations, trimmed to fit), and the planner's inputs (crop model, priority, prices and costs) live in the same panel and can also be said in the question ("el haba a 5,000 pesos"). "Abrir en el planificador completo" opens the full planner with the same settings.

**Plugging in a real language model.** `src/assistant/backend.ts` is the seam. A backend provides `interpret(message, settings, options)` (which models, which settings; an LLM could do this with tool calling over `models.ts`; `options.farm` carries the farmer's answers to the questions, and the `Interpretation` returned must carry them on so the planner honours them) and optionally `narrate(outcomes, interpretation, language)` (the summary; when present it replaces the template and the page says who wrote it). What a backend needs: an endpoint that takes the message, the conversation and the current settings and returns an `Interpretation`; and, for narration, text that only restates numbers present in the outcomes it was given. The models and their results do not change. Streaming would need a backend that streams, plus a change to show partial text in `AssistantMessageView`.

## Screens

The planner is also a page of its own.

**Strategy planner.** Pick a crop model (calibrated to SIAP, or standard WOFOST), say how much each objective matters, and the app shows the trade-off curve of rotation, fertilizer and stover decisions and suggests a compromise. Click a point (or a table row) to see its plan.

**Live prices.** Grain prices, other costs, the nitrogen price and the stover price are editable. Changing one re-scores all 4,284 strategies in the browser (about 50 ms) and recomputes the curve and the suggestion; when the new figures change the suggestion, the plan card says what it was at the original figures. SIAP's latest price per crop is listed next to each grain price. How it works:

- `grid.json` holds the WOFOST season outcomes the planner scores from (design years 2006–2021, every rotation at each fertilizer scale, both parameter sets). `src/lib/planner.ts` is a port of the Python planner's `Grid` / `Planner` / `brute_force`.
- `src/lib/front.ts` ports the Python planner's `pareto_front` and `choose`. A weight of 0 narrows the five-objective front to the other objectives (exact, up to ties; tested against re-scoring the whole lattice).
- Tests check the port against the Python: the live front must equal the front the Python planner saved (`src/lib/fixtures/reference_fronts.json`) strategy by strategy, the four compromises of the NSGA results write-up must come out, and so must its picks when the faba bean and stover prices change.
- Prices, production costs, the nitrogen price and the stover price are the planner's placeholders (only grain prices are sourced), and the two crop models disagree about fertilizer; the app says so on every screen.

## Run it

From this folder (`frontend/`):

```bash
npm ci           # exact versions from package-lock.json
npm run dev      # http://localhost:5173 (the home page; the WhatsApp simulation is at /demo/whatsapp)
npm test         # planner and front logic against the Python results, translation key parity
npm run lint
npm run build    # type-check and build to dist/ (assets and data are served from the site root)
```

Needs Node 22.12 or newer (`nvm use` picks it up from the repository's `.nvmrc`). No backend, API key or Python is needed: everything the app reads is committed in `public/data/`. The build in `dist/` is plain static files, so any static host that serves the app at the root of a site can serve it. To host it under a sub-folder, build with `VITE_BASE=./ npm run build` (relative paths; use the `#/demo/whatsapp` link form) or `VITE_BASE=/folder/ npm run build`.

## Deploying to Netlify

In Netlify: branch `main`, base directory `frontend`, build command `npm run build`, publish directory `dist` (the same values are in `netlify.toml`, together with `NODE_VERSION = "22"` and cache headers). The app needs no environment variables and no secrets: everything it reads is in `public/data/` and ends up in `dist/data/`, fetched from the site root (`/data/...`). `public/_redirects` sends any path that is not a real file (for example `/demo/whatsapp`) to `index.html`, because the app picks its page from the address; files such as `dist/assets/*` and `dist/data/*.json` are served as they are. Only the map tiles (OpenStreetMap, NASA GIBS) and the NASA POWER climate service are fetched from other hosts, from the visitor's browser.

## Data

`public/data/` holds what the app reads. `meta.json`, `grid.json` and `models.json` are exports of the project's Python modelling results (the planner grid, the saved fronts, the rotation-risk, calibration and ensemble scores). To refresh them, replace the three files, and `src/lib/fixtures/reference_fronts.json` which the tests compare against, with a new export; the exporter refuses fronts that were not computed from the current planner grid. `municipios.json` is a one-off extract used by the place search (see above) and is not regenerated. Nothing in this folder changes the science: if the models change, replace the JSON, and the tests say whether the planner port still agrees with them.

## Layout

```text
public/data/        JSON exported from the project's modelling results (meta.json, grid.json, models.json) and municipios.json (place search)
src/lib/            types, JSON loading, planner scoring, Pareto front and compromise choice, number formats,
                    distance, NASA climate, coverage verdict, saved pin, the farmer's answers as model inputs (farm.ts)
src/lib/fixtures/   Python's saved fronts, for the port's tests only
src/i18n/           en.ts is the source of truth for keys; es.ts must match (tested)
src/components/     scatter chart (SVG), plan card, weights panel, front table
src/account/        simulated accounts: users (tested), per-account storage keys, provider and context, the account menu
src/screens/        the sign-in page, the map step and the full planner (Técnico)
src/farmer/         Agricultor: answers, recommendation, saved list, chat rules, municipality search, location, voice (+ tests)
src/farmer/ui/      the Agricultor home (FarmerHome), the guided questions, the chat, the parcel tools for Técnico (ParcelTools), the recommendation card (full and brief)
src/assistant/      the assistant: model registry, question parser, runners, summaries, history, backend seam
src/assistant/ui/   chat page, message view, result cards, models panel, history, the guidance card
src/onboarding/     the questions: answers and their storage, readers for typed text, what Continue does, summary wording
src/onboarding/ui/  one screen per question, the summary and the page that runs them
src/hooks/          the pin's coverage verdict and NASA climate
src/theme.css       the design system (orange, black, white), sign-in, account menu and every Agricultor style; remaps the old palette names
src/home.css        old home-page styles (unrouted) and the original palette names
src/where.css       the map step
src/assistant.css   the Técnico pages (assistant and full planner); colours come from index.css
src/onboarding.css  the questions, the guidance card and the "Tu campo" card
```

Charts in Técnico use the same orange, black and white (rotation = marker shape, nitrogen lost = an orange ramp, suggested plan = an orange ring). The app is light only.

## WhatsApp simulator (`/demo/whatsapp`)

A WhatsApp-style chat that shows how YolIA could answer a farmer by text message. It is a **simulation**: nothing is sent to
WhatsApp, Twilio or any API, and it needs no key, internet or language model. It reuses the farmer assistant's rules
(`src/farmer/chat.ts`), the planner and the stored risk results (`src/farmer/recommend.ts`) and the existing Spanish copy;
the only new code is in `src/whatsapp/`. The demo has three reference locations, defined once in `src/lib/demoLocations.ts` (Guanajuato, Sinaloa, Sonora; reference points, not verified parcels). All three places answer from their rotation run (`public/data/rotations/<id>.json`; exploratory scenarios, gross income per hectare, low confidence) and their environmental package. The simulator asks nothing first: pick a place and ask. It has a language toggle (ES / EN) in its header, follows the language already chosen in the app, and restarts the chat in the new language. The service's own Spanish text (plan description, highlights, confidence reasons, crop names) is translated from known sentences in `src/lib/rotationText.ts`; an unknown one is shown as written, and `rotationText.test.ts` fails when a published run contains one. If a rotation file is missing or invalid, that location shows "Data unavailable"; no location ever reuses another's results.

A parcel pinned within 25 km of Sinaloa's or Sonora's run point (the app's own "inside" distance; `nearRotationSite` in `src/lib/rotations.ts`) gets those rotation results on **Qué sembrar** (`src/farmer/ui/RotationPlant.tsx`) instead of the "outside the model zone" refusal, with a notice on the parcel page. They are per hectare and do not depend on the parcel questions. Pins farther away keep the refusal: the results say nothing about them.

### Daniel's data in the app (`public/data/environment/` and `public/data/rotations/`)

Two files per place come from the data service (`gradientdescentfarmers/source_builder` and `rotations_service`), both private in GCS (`gdfarming-farm-data`, `gdfarming-farm-rotations`):

| File | What it holds | Where it shows |
| --- | --- | --- |
| `environment/<place>.json` (Guanajuato, Sinaloa, Sonora) | The whole FarmProfile: two years of NASA POWER weather (monthly, annual and daily), SoilGrids soil, SRTM terrain, MODIS vegetation, evapotranspiration and surface temperature, SMAP soil moisture, GPM rain, World Bank context, the status of every source, the readiness gates, blockers and limits | **Qué sembrar** for a parcel near the place (`EnvironmentPanel`), the WhatsApp chat (climate, soil, satellite and sources questions) |
| `rotations/<place>.json` (Guanajuato, Sinaloa, Sonora) | The rotation options, income, confidence, and how the run was set up: settings, soil model, prices used, rejected simulations | **Qué sembrar** (`RotationPlant`), the WhatsApp chat |

A parcel within 25 km of a place (the app's own "inside" distance; `nearZone` in `src/lib/environment.ts`) gets what was published for it instead of the "outside the model zone" refusal; the map step says so too and has one-tap shortcuts to the three places. Farther pins keep the refusal. 

To refresh them, download a run (needs access to the `gdfarming` project) and slim it:

```bash
gcloud storage cp -r "gs://gdfarming-farm-data/farm_profiles/<farm_id>/runs/<run_id>/*" ./profile/
node scripts/slim-profile.mjs <guanajuato|sinaloa|sonora> ./profile

gcloud storage cp -r "gs://gdfarming-farm-rotations/farm_rotations/<farm_id>/source_runs/<source_run_id>/runs/<rotation_run_id>/*" ./rotations/
node scripts/slim-rotations.mjs <sinaloa|sonora> ./rotations/rotations.json
```

The scripts copy the figures (rounded to 2-3 decimals for size) and drop server paths and hashes. `src/lib/environment.ts` and `src/lib/rotations.ts` check each file when it is loaded; a file that is missing or invalid just leaves that place without it. Not copied: `model_evaluations.jsonl` and `pcse_weather_daily.csv` (the simulator's own per-scenario ledger and a copy of the weather already in the environment file). Current runs: Sinaloa `b50bfdf0a58240aa` / `be357172bae941c1`, Sonora `9849d2f76f944625` / `5abb561d6ead496b`, Guanajuato `67b66942681a4214`. A new place needs an entry in `src/lib/demoLocations.ts`.

**Guanajuato's rotation run (`43c997719c054cf3`) was generated locally** with Daniel's own pipeline on his published Guanajuato profile (`67b66942681a4214`), because the rotations service had not run it: Python 3.11, `pip install "pcse==6.0.13" pydantic pandas "numpy<2" pyarrow==20.0.0 "shapely>=2,<3" requests`, then `python -m gradientdescentfarmers.rotations_service run --profile-dir <profile> --source-uri gs://gdfarming-farm-data/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214 --config <json with model.state_id_hint "11">`. It used the same code, crop parameters (commit `fc6eda4`) and public SIAP prices as the Sinaloa and Sonora runs (40 simulations, 4 options). It has not been published to the `gdfarming-farm-rotations` bucket; if the service later publishes its own run, replace the file with `scripts/slim-rotations.mjs`.
