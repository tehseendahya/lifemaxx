# Lifemaxx — All-in-One Health Tracker + AI Coach

**Status:** draft spec for discussion
**Owner:** tehseendahya

---

## 0. TL;DR — the decisions

| Question | Answer | Why |
|---|---|---|
| Native app or web? | **Installable PWA** (Next.js), not TestFlight | One codebase, ships today, no Xcode/Mac/App Review, instant updates. iOS home-screen PWAs get camera, offline, and **push notifications** (16.4+). TestFlight builds expire every 90 days and need a re-upload. |
| Do I need a database? | **Yes. Postgres.** | Phone ↔ laptop sync is the whole point. Local-only storage (IndexedDB) can't do that, can't aggregate "bench e1RM over 6 weeks", and can't feed the coach. |
| Which one? | **Supabase** (Postgres + Auth + cron) | Free tier covers this forever at 1 user. Auth is included (magic link), so you don't hand-roll sessions. Neon + Auth.js is the equivalent alternative. |
| Object storage for photos? | **No.** | Photos are analyzed in-memory and discarded. Kills an entire layer of the stack (buckets, signed URLs, storage RLS, cleanup jobs). Optional: keep a 128px thumbnail (~6KB) inline in Postgres so the day-summary is visual. |
| Strava via MCP? | **No — use the Strava REST API directly.** | MCP is a protocol for giving *a chat assistant* tools. Your web app should just call Strava's API. (An MCP server is still worth building *later*, pointed at your own DB — see §8.) |
| Apple Health? | Via **Health Auto Export → webhook** | The web platform cannot read HealthKit. That $5 iOS app can POST steps/sleep/weight/HR to your API on a schedule. Cheapest possible bridge. |
| Progression suggestions | **AI proposes, bounded** | With RPE, to-failure and recovery in context there's real signal to reason over. Guardrails in §5.2: show the mechanical baseline alongside, cap the jump at one increment. |
| Time to build | **~3 days**, usable after 2 | Phasing in §9. |

---

## 1. Product shape

Three logging surfaces, one brain.

```
     ┌─────────── Log (phone, <10s per entry) ───────────┐
     │  🍽 Meal: photo + note   →  macros                │
     │  🏋 Lift: "bench 5x5 185" →  sets                 │
     │  🏃 Cardio: auto from Strava                       │
     │  ⚖ Weight: one number, every morning              │
     └────────────────────┬──────────────────────────────┘
                          ▼
             ┌────────── Postgres ──────────┐
             │  meals · sets · activities   │
             │  weights · daily rollups     │
             └────────────┬─────────────────┘
                          ▼
       ┌──────── Review (laptop or phone) ────────┐
       │  Today: kcal/P/C/F vs target             │
       │  Exercise page: last session + trend     │
       │  Coach: chat + nightly push              │
       └──────────────────────────────────────────┘
```

**Design rule that governs everything:** logging must survive a gym basement with no signal, and take under 10 seconds. Every write is optimistic + queued locally; the network is best-effort.

---

## 2. Platform: why PWA over TestFlight

What you'd lose by going native-first: a week of setup (Apple Developer account, provisioning, Xcode, App Store Connect, review), a second codebase for the laptop, and a 90-day expiry treadmill on every TestFlight build.

What a PWA actually gives you on iOS today:

- **Camera** — `<input type="file" accept="image/*" capture="environment">` opens the camera directly. No permission dance.
- **Home-screen install** — full-screen, no browser chrome, own icon. Feels native enough.
- **Push notifications** — iOS 16.4+ supports Web Push **for installed PWAs only**. This is the one real gotcha: you must Add to Home Screen before notifications work.
- **Offline** — service worker + IndexedDB outbox.

What it can't do: read HealthKit, run background sync reliably on iOS, or use the `BarcodeDetector` API (Safari lacks it — fall back to photographing the label, which the vision model reads fine).

None of those are core. **Build the PWA. Wrap it in Capacitor later** (a ~1 day job) *only if* you decide you want HealthKit or a widget — Capacitor ships the same web app as a native binary, so nothing is thrown away.

---

## 3. Stack

```
Next.js 15 (App Router, TS)      — one app, phone + laptop
Tailwind + shadcn/ui             — fast, looks fine, dark by default
Supabase Postgres + Auth         — data + magic-link login, RLS on user_id
Drizzle ORM                      — typed queries + migrations in git
Anthropic SDK (claude-opus-5)    — vision, NL parsing, coach
Web Push (VAPID) + Vercel Cron   — nightly digest, coach nudges
Dexie (IndexedDB)                — offline outbox + cached exercise history
Recharts                         — trend lines
Vercel                           — deploy, free tier
```

Everything above has a free tier that a single user will never exhaust.

---

## 4. Data model

```sql
users(id, email, tz, created_at)

-- targets, versioned so you can see what you were aiming for back then
targets(id, user_id, effective_from date,
        kcal, protein_g, carbs_g, fat_g, mode)  -- mode: cut|maintain|bulk

-- MEALS
meals(id, user_id, eaten_at timestamptz, local_date date,
      slot,                    -- breakfast|lunch|dinner|snack
      note text,               -- your free-text: "half the rice, extra chicken"
      kcal, protein_g, carbs_g, fat_g,
      source,                  -- photo|text|repeat|manual
      confidence,              -- 0-1 from the model
      thumb bytea null,        -- optional 128px jpeg, ~6KB
      created_at)

meal_items(id, meal_id, name, qty, unit,
           kcal, protein_g, carbs_g, fat_g)   -- editable line items

-- TRAINING
gyms(id, user_id, name, lat, lng,
     equipment_notes)                          -- "dumbbells only to 50lb, no SSB"

exercises(id, user_id null, name, canonical_slug, equipment, is_unilateral)
exercise_aliases(id, exercise_id, alias)       -- "bench","bp","barbell bench"

exercise_muscles(exercise_id, muscle,          -- chest|front_delt|tricep|lat|...
                 contribution)                 -- 1.0 primary, 0.5 secondary

workouts(id, user_id, gym_id, status,          -- active | completed | abandoned
         started_at, ended_at, local_date,
         name,                                 -- auto: "Push — Chest & Triceps"
         bodyweight_kg null, note)

sets(id, workout_id, exercise_id, set_index,
     reps, weight_kg, rpe null,
     to_failure bool, is_warmup bool,
     rest_s null,                              -- measured from previous set save
     note,                                     -- "left shoulder pinched on set 3"
     e1rm_kg generated,                        -- Epley: w * (1 + reps/30)
     raw_text, logged_at)

session_messages(id, workout_id, role, content, created_at)   -- the in-session chat

muscle_readiness(user_id, muscle, local_date,  -- optional self-report
                 soreness)                     -- 0-3, tapped on the homepage

-- CARDIO / EXTERNAL
activities(id, user_id, external_id, provider,  -- strava|manual|healthkit
           type, started_at, local_date,
           duration_s, distance_m, elevation_m,
           avg_hr, kcal, name)

-- BODY
body_metrics(id, user_id, local_date, weight_kg,
             body_fat_pct null, steps null, sleep_min null,
             resting_hr null, source)

-- COACH
daily_summaries(id, user_id, local_date,
                totals jsonb, verdict text, generated_at)
coach_messages(id, user_id, role, content, context_hash, created_at)
```

Two things worth noticing:

- `sets.raw_text` keeps what you typed. If the parser mangles something you can re-parse later without losing the original. Also becomes training data for improving the prompt.
- `targets` is versioned by date, not a single row you overwrite. Six months from now you'll want to know what you were actually aiming for in March.

---

## 5. Feature spec

### 5.1 Meal logging

**Flow (target: 8 seconds):**

1. Tap **+ Meal** → camera opens.
2. Snap. Client resizes to 1024px longest edge, JPEG q0.8 (~120KB) — resize **before** upload, this is the difference between 1s and 8s on cell data.
3. Optional one-line note: *"about 2 cups of rice, chicken thigh not breast"*. This note matters more than the photo for accuracy — the model can't see portion mass or cooking oil.
4. POST to `/api/meals/analyze`. Server calls Claude with vision + a strict tool schema, returns line items.
5. Editable confirmation card appears. Tap a number to fix it. Save.
6. Image is never written to disk. Optional 128px thumb stored inline.

**Accuracy honesty:** photo-based macro estimation is roughly ±20% on a single meal, and it systematically under-counts cooking oil. Two mitigations:
- Push the **note** hard in the UI — it's where the real signal is.
- The **adaptive TDEE** loop (§5.5) makes absolute accuracy mostly irrelevant, as long as the error is *consistent*. That's the actual unlock.

**Quick paths that skip the camera entirely:**
- **Repeat** — recent + most-frequent meals, one tap. You eat the same breakfast 200 days a year.
- **Text only** — "2 eggs, 3 strips bacon, black coffee" → same parser, no photo.
- **Voice** — dictate, same parser.

### 5.2 The lift session

Lifting is not a form you fill in afterwards. It's a live session with a clock, and the app should behave like one — closer to Strava's record screen than to a spreadsheet.

**Lifecycle:**

```
START LIFT  →  pick gym (defaults to last / nearest)  →  clock starts
              ↓
   for each exercise:
     add set → reps · weight · RPE · [to failure] · note
     ask     → "another set?"  "go up in weight?"  "shoulder feels off"
              ↓
STOP LIFT   →  duration · auto-name from muscles hit · session summary
```

**What gets captured per set:** reps, weight, RPE, a `to_failure` flag, a free-text note, and `rest_s` measured automatically from the gap since the previous save. That last one is free data — you're already tapping — and rest length is a real input to whether the next set should go up.

#### Durability — the one change I'd make to your flow

You described writing the whole lift to the database on Stop. **Don't do that.** A session is 60–90 minutes, and iOS Safari evicts backgrounded tabs aggressively. One phone call, one low-battery shutdown, one accidental swipe and the entire workout is gone — including the part you'd already done.

Keep the *feel* exactly as you described, but split durability from commit:

| | When | Where |
|---|---|---|
| **Every set save** | instantly | IndexedDB, and pushed to Postgres if online |
| **Session row** | on Start | created with `status = 'active'` |
| **Stop Lift** | on tap | `status → 'completed'`, name + duration computed, summary shown |

You still get one atomic-feeling session. But if the phone dies at exercise four, reopening the app finds an `active` workout and offers to resume it with everything already in place. A session left open more than ~6 hours gets auto-closed as `abandoned` at its last set time.

#### The in-session coach

This is the feature that makes the session model worth building. Between sets you ask, in plain language:

> *"should I do another set?"*
> *"go up in weight next week or add a rep?"*
> *"shoulder's pinching on incline — swap to something?"*

**Context it answers from:** the live session so far (every set already logged today, with RPE and failure flags), the last 3–5 sessions for these exercises, weekly set volume for the muscles involved, bodyweight trend and calorie balance, sleep and steps if connected, and the gym's `equipment_notes` so it never suggests a machine that isn't there.

**Latency is the design constraint.** You're asking this on 90 seconds of rest. Two things make it fast:

- **Cache the context prefix at Start Lift.** History, exercise records and targets are stable for the whole session — send them once with a cache breakpoint and every mid-session question is a small delta on a warm cache. Cheaper and materially faster.
- **Prefetch on Start.** All of it comes down before you touch a barbell, so questions work with no signal.

**Suggestions, with two guardrails.** The model proposes the progression — that's the right call now that it can see RPE, failure and recovery. But:

1. **Show the mechanical baseline next to it.** "Rule says 185×5×3. I'd say 190×5×3 — last set was RPE 7 and you weren't near failure." When the AI deviates you can see it deviating, and why. That's what keeps it trustworthy over months.
2. **Bound the jump.** No more than one standard increment or ~10% in a single step, whichever is smaller. Enthusiasm is not a training variable.

#### Muscle accounting

Every exercise maps to muscles with a weight — `bench → chest 1.0, front_delt 0.5, tricep 0.5`. A working set therefore contributes fractional **hard sets** to several muscles, which is the metric that actually matters for hypertrophy (most people want roughly 10–20 hard sets per muscle per week).

That gives you two things for free:

- **Auto-naming.** Rank muscles by hard sets in the session, name it accordingly — *"Push — Chest & Triceps"*, *"Pull — Back & Biceps"*, *"Legs"*. Falls back to *"Full Body"* when nothing dominates. Editable, and your edit is remembered for that shape of session.
- **Weekly balance.** Sets per muscle per rolling 7 days, which is where you'll discover your rear delts have had four sets since March.

#### Homepage: what to train next

Each muscle gets a readiness score from three inputs:

```
days since last trained   (recovery, 48-72h typical)
sets in last 7d vs target range   (under-worked ranks up)
self-reported soreness    (optional, tapped on the homepage)
```

Ranked ascending, so the homepage opens with *"Back and rear delts — both under 8 sets this week, last hit 5 days ago."*

**One honest caveat:** soreness is not something the app can measure. It can compute *recovery time* and *volume debt* from data you're already producing, and those two carry most of the signal. If you want soreness in the mix it has to be a tap — a 4-state chip per muscle group, five seconds on the homepage. Worth including as optional; not worth blocking the feature on.

#### Text entry still exists

Fast entry stays for when you don't want the session UI — type `bench 5x5 185` and it parses to sets through a strict tool schema. Notation handled: sets×reps, weight×reps, comma-separated sets, `@rpe8`, `bw+25`, lb/kg, per-side dumbbell weight. It writes into the active session if one is open, or creates a completed one if not.

**Exercise resolution** is the part that quietly breaks these apps. "bench", "bp", "barbell bench press" and "flat bench" must all land on one row or your trend charts fragment into confetti. Exact alias match, then `pg_trgm` fuzzy match, then ask the model — and if it's genuinely new, it proposes a canonical name and muscle mapping you confirm once.

### 5.3 Cardio / Strava

- **OAuth** connect once. Store refresh token.
- **Nightly pull** of `/athlete/activities` (Vercel Cron, 3am local). Simpler than webhooks — no public callback validation, no replay handling — and you don't need runs to appear in real time.
- Upgrade to webhooks later only if you want instant sync.
- Manual entry stays available for anything not on Strava.

### 5.4 The AI coach

Two modes:

**Ask (chat).** You ask, it answers with your actual data in context:
> *"am I actually progressing on bench or just adding volume?"*
> *"why did I stall last week?"*
> *"what should I eat tonight to hit protein?"*

Context assembly is plain SQL, not RAG — you have one user and small data. Pull last 14 days of daily rollups + the relevant exercise history + current targets ≈ 10–20K tokens. No vector DB. No embeddings. Don't over-engineer this.

**Tell (proactive push).** Scheduled, opinionated, short:
- **Nightly 9pm** — day verdict. *"1,840 kcal, 112g protein. You're 38g under protein for the 4th day running — that's the thing to fix, not the calories."*
- **Sunday 6pm** — weekly review. Weight trend vs intake, estimated TDEE, lifts that moved and lifts that stalled, one thing to change.
- **Conditional nudges** — 8pm and protein < 60% of target; 3 days logged with no lifts; a PR worth celebrating.

Rule: **every notification must be actionable or it gets ignored.** "You ate 1,840 calories" is a fact. "You're short 38g protein, that's a shake and a yogurt" is advice. Only send the second kind.

**Voice: blunt analyst.** Encoded in the system prompt as hard rules, not vibes:

- Lead with the number that's wrong. Don't recite the ones that are fine.
- **One** recommendation per message. Never a list. If two things are off, pick the one with more leverage and say why it's first.
- No praise unless it's a real PR or a streak that actually held. Manufactured encouragement trains you to skim.
- Name the tradeoff when there is one — *"you can keep the deficit or keep adding weight to squats this month, probably not both."*
- Never hedge. No "it might be worth considering." Say the thing or don't send the message.
- **Say "not enough data" when there isn't any.** Under ~5 logged days in a window, the honest answer is that the trend is noise. A coach that pattern-matches on four days of data is worse than one that stays quiet, and this is the single easiest way for the whole feature to lose your trust.

### 5.5 Adaptive TDEE — the highest-value feature you didn't ask for

Log body weight most mornings. Then:

```
TDEE ≈ (14-day mean intake) + (7,700 kcal/kg × weight-trend-per-day)
```

Using an exponentially-smoothed weight trend, not raw daily weights (daily fluctuation is water and is meaningless).

This gives you a **measured** maintenance number instead of a calculator's guess, and it recalibrates weekly as you get leaner. It also *cancels out systematic logging error*: if the vision model consistently reads your meals 15% low, your computed TDEE comes out 15% low too, and the target it sets is still correct.

It's ~30 lines of code and it's the difference between a food diary and something that actually steers.

**Calibration mode — the first two weeks.** Since the goal is undecided, the app should not make you pick one on day one. A calculator's guess at your maintenance would be wrong by 200-400 kcal, and you'd anchor on it anyway.

Instead:

| | Days 1–14 | Day 14 onward |
|---|---|---|
| Targets | **Protein only.** No calorie target shown, nothing marked pass/fail. | Real targets, derived from your measured TDEE. |
| Coach talks about | Logging consistency, protein, training. | Everything, against real numbers. |
| Weight | Logged daily, trend building silently. | Drives the target each week. |

On day 14 the app has a measured maintenance number and proposes: *"Your maintenance is ~2,610. Cut at 2,150, maintain at 2,600, or lean bulk at 2,850?"* You pick once, with real data, and `targets` gets its first row. Mode is switchable any time after that and the history is preserved.

Protein is the exception that's targeted from day one because it's the one number that's right regardless of goal (~1.6–2.2 g/kg bodyweight, cutting or bulking).

### 5.6 Other things worth adding

**In scope, cheap, high value:**
- Body weight — one tap, big number pad, morning reminder
- PR detection — auto-flag rep PRs and e1RM PRs, push a congrats
- Rest timer — starts on set save, tap to skip
- Weekly digest — the Sunday review above
- CSV/JSON export — never be locked into your own app
- Streaks — logging consistency, not perfection

**Later / only if you want it:**
- Sleep + steps (Health Auto Export bridge)
- Barcode scanning (Android only via `BarcodeDetector`; iOS = photograph the label)
- Photo thumbnails in the day summary
- Plate calculator ("185 lb = 45+25 per side")
- Deload detection from volume + RPE trends

**Deliberately skipping:** hydration tracking (nobody sustains it), social feed, macro cycling, a food database (the vision model *is* the database — no USDA integration needed).

---

## 6. AI implementation

All calls use `claude-opus-5` (1M context, $5/$25 per MTok) with **strict tool schemas** so output is guaranteed-valid JSON, and adaptive thinking. Cost control comes from `output_config.effort`, not from downgrading models.

| Route | Effort | Shape |
|---|---|---|
| `POST /api/meals/analyze` | `low` | image + note → `log_meal` tool → items[] with per-item macros + confidence |
| `POST /api/sets/parse` | `low` | text + known-exercise list → `log_sets` tool → sets[] |
| `POST /api/session/ask` | `medium` | live session + history, **cached prefix** → short answer, streamed |
| `POST /api/session/suggest` | `medium` | exercise + session state → next-set proposal + one-line reason |
| `POST /api/coach/chat` | `high` | 14d context + question → prose, streamed |
| Cron nightly / weekly | `medium` | day or week rollup → 2–3 sentence verdict |

**Failure handling that matters:** if the parse call fails or you're offline, **save the raw text anyway** and mark it `needs_parse`. A background job retries later. You should never lose a log because a network call failed mid-set.

**Prompt caching is what makes the in-session coach affordable.** The session context — history, records, weekly volume, gym equipment — is ~15K tokens and completely stable for the whole workout. Write it to cache once at Start Lift, and every question after that reads it at a tenth the price. Six questions in a session cost roughly what one uncached question would.

**Estimated cost** (~4 meals/day, 4 lifts/week at ~6 questions each, 1 coach chat/day):

| | per month |
|---|---|
| Meal vision, ×4/day | ~$3.00 |
| Lift sessions — cache write + ~6 questions each | ~$3.40 |
| Set parsing | ~$0.30 |
| Nightly verdict | ~$1.20 |
| Coach chat, ×1/day | ~$3.00 |
| **Total** | **~$11/mo** |

Hosting, database, and push are $0 on free tiers. Call it **under $15/month all-in** — and if the in-session coach turns out to be the part you actually use every day, that's the cheapest line on the list to let run.

---

## 7. Offline behavior

Non-negotiable, because gyms have concrete walls.

- Every write goes to an **IndexedDB outbox** first, then syncs. UI updates immediately.
- Exercise history (last session + target for every exercise) is **prefetched on app open** and cached. The progressive-overload screen works with the phone in airplane mode.
- Meal photos queue as blobs and analyze when connectivity returns.
- Conflict resolution: last-write-wins per row. Single user, single logical timeline — this is genuinely fine, don't build CRDTs.

---

## 8. MCP — the right way to use it here

Your web app should **not** talk to Strava through MCP. It should call Strava's REST API. MCP is a protocol for exposing tools to an AI *chat client*; putting it in the request path of your own app adds a hop and buys nothing.

Where MCP *is* genuinely worth it: **build a small MCP server over your own database.** Then, from Claude Desktop or the Claude mobile app, you can ask ad-hoc questions your app's UI doesn't cover — *"correlate my squat e1RM with sleep from the last three months"* — without shipping a feature for every question. Read-only, a handful of query tools, maybe 150 lines. Great weekend follow-on, not day-one work.

---

## 9. Build plan

**Day 1 — logging works end to end**
1. Next.js + Tailwind + Supabase + Drizzle scaffold, magic-link auth
2. Schema + migrations
3. Meal capture: camera → resize → vision → editable card → save
4. Today screen: totals vs target, meal list
5. Deploy to Vercel, install to home screen on the phone

**Day 2 — the lift session**
6. Start/Stop session, gyms, per-set capture (reps, weight, RPE, to-failure, note)
7. Exercise resolution + aliases, muscle mapping, auto-naming
8. Exercise detail screen (last session, e1RM trend, suggestion + baseline)
9. In-session coach with cached context prefix
10. Service worker, IndexedDB outbox, crash-resume for active sessions

**Day 3 — the rest**
11. Body weight + adaptive TDEE, calibration mode
12. Weekly muscle balance + homepage "what to train next"
13. Coach chat over 14-day context, nightly + Sunday digests, Web Push
14. Strava OAuth + nightly pull, trend charts, PR detection, export

Days 1–2 give you a genuinely usable app. Day 3 is upside.

---

## 10. Decided / open

### Decided

| | |
|---|---|
| **Goal** | Undecided by design — two-week calibration, then the app proposes targets from measured TDEE (§5.5). |
| **Coach tone** | Blunt analyst (§5.4). |
| **Platform** | Installable PWA. Capacitor later only if HealthKit becomes worth it. |
| **Database** | Supabase Postgres. No object storage. |

### Still open

1. **Units** — lb or kg on screen? (Storage is kg internally either way.)
2. **Photo thumbnails** — keep a 128px thumb (~6KB/meal, ~2MB/year) so the day summary is visual, or truly store nothing?
3. **Strava** — connect on day 3, or skip cardio entirely for now?
4. **Training split** — do you follow a named program with fixed days, or decide at the gym? Changes whether the app suggests *today's session* or just waits for you to type.
5. **Weigh-in reliability** — adaptive TDEE degrades fast below ~4 weigh-ins/week. Realistic for you, or should the math be tolerant of gaps?
