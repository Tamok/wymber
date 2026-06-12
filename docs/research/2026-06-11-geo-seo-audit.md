# GEO / SEO Audit — Wymber (wymber.app + web.wymber.app)

**Date:** 2026-06-11 · Full audit of search-engine and generative-engine visibility: repo, live
sites, Cloudflare zone config (via API), and June-2026 state-of-the-art research. Goal: top-notch,
*ethical* GEO/SEO ("the organic tomatoes of GEO/SEO": allow citation, decline training, never
deceive, especially given the YMYL mental-health context).

## Verdict: **Wymber is currently invisible by configuration, not by competition.**

Three independent checks agree:

1. **Cloudflare is hard-blocking every AI crawler at the edge.** The zone API returns
   `ai_bots_protection: "block"` for wymber.app. Live tests confirm: requests with
   OAI-SearchBot, PerplexityBot, and GPTBot user agents all get **403** before reaching the site.
   This blocks not just training bots but the *answer-serving* crawlers (ChatGPT Search,
   Perplexity, Claude search). No GEO tactic matters while this is on.
2. **The site is effectively absent from web search.** Searches for "wymber", "wymber.app",
   "wymber app privacy trauma mapping" return nothing about the product (only Wymbe, WymBee,
   Wibber, etc.). There is no sitemap, no evidence of Search Console / Bing Webmaster
   registration, and (as a new domain) essentially no backlinks.
3. **The crawlable surface is one page.** AI engines cite pages that answer specific questions.
   A single landing page (plus a changelog and a sources page) gives them almost nothing to cite,
   and the landing never uses the category language people actually search with.

The good news: the foundations are unusually strong (semantic HTML, real a11y, fast, no JS-walled
content, an honest sources page, an open repo). The gap is access + breadth + entity presence,
all fixable.

---

## 1. What the audit found

### 1.1 The edge block (P0, decisive)

- Zone `wymber.app` (`b6c0b6ee0144ebd9eebaf2d884a48342`):
  `ai_bots_protection: "block"`, `is_robots_txt_managed: true` (checked 2026-06-11 via
  `GET /zones/{id}/bot_management`).
- Confirmed live: `curl -A "<OAI-SearchBot UA>" https://wymber.app/` → **403**. Same for
  PerplexityBot and GPTBot UAs. Plain browser/curl UAs get 200.
- The managed robots.txt (served on **both** hosts) says:
  - `User-agent: *` → `Content-Signal: search=yes,ai-train=no` + `Allow: /`
  - Hard `Disallow: /` for: Amazonbot, Applebot-Extended, Bytespider, CCBot, **ClaudeBot**,
    CloudflareBrowserRenderingCrawler, **Google-Extended**, **GPTBot**, meta-externalagent.

Why this matters (2026 crawler taxonomy, from [OpenAI](https://platform.openai.com/docs/bots),
[Anthropic](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler),
[Perplexity](https://docs.perplexity.ai/guides/bots) bot docs):

| Purpose | Bots | Blocking effect |
|---|---|---|
| **Training** | GPTBot, ClaudeBot, CCBot, Google-Extended, meta-externalagent, Bytespider, Applebot-Extended | Content stays out of future model weights. Privacy-aligned; fine to keep blocking. |
| **AI search index** | OAI-SearchBot (ChatGPT Search), Claude-SearchBot, PerplexityBot | Blocking = never cited in those engines. **Currently blocked by the edge rule (not by robots.txt).** |
| **User-triggered fetch** | ChatGPT-User, Claude-User, Perplexity-User | Blocking = "I can't open that link" when a user pastes wymber.app into a chat. **Currently blocked by the edge rule.** |
| **Google Search + AI Overviews/AI Mode** | Googlebot (Google-Extended does *not* control AI Overviews) | Not robots-blocked. Unaffected by Google-Extended block. Gemini-app grounding *is* affected by the Google-Extended block (accepted trade-off if anti-training stance stays). |

The robots.txt posture (search yes, training no) is exactly the defensible 2026 default. The
**edge enforcement** is the problem: it overrides that nuance and 403s everything with an AI UA.

### 1.2 robots.txt / sitemap / 404 hygiene (P0/P1)

- **robots.txt is malformed.** Cloudflare prepends its managed block to whatever the origin
  serves for `/robots.txt`, and the origin (Pages SPA fallback) serves… the full homepage HTML.
  The live file is valid directives followed by ~270 lines of HTML. Parsers tolerate it, but it's
  garbage in the single most-read file on the site.
- **Soft-404s everywhere.** Any path on wymber.app (e.g. `/sitemap.xml`, `/llms.txt`,
  `/this-page-does-not-exist`) returns **200 + homepage HTML** because there's no `404.html` in
  the Pages project. Classic crawl-budget/index-pollution bug, and it's why
  `web.wymber.app`'s `og:image`… see next item.
- **The app's share preview is broken.** `frontend/index.html` declares
  `og:image: https://wymber.app/static/og-image.png` and `og:url: https://wymber.app/`. On the
  landing origin that path serves `text/html` (the soft-404), so sharing **web.wymber.app**
  anywhere renders no image, and its og:url claims to be a different site. The real image lives at
  `https://web.wymber.app/static/og-image.png` (verified `image/png`).
- **No sitemap.xml** on either host.

### 1.3 On-page (P1)

Landing (`landing/index.html`):
- Has: title, meta description, og:title/description/type/url, `lang`, semantic headings,
  excellent alt text. Genuinely clean HTML that crawlers fully see (no JS needed). Good.
- Missing: `rel=canonical`, **og:image** (no social/AI-chat preview card at all), `og:site_name`,
  `twitter:card`, any **JSON-LD** (no Organization, WebSite, or SoftwareApplication entity), and
  any use of the category vocabulary (see 1.5).

App (`frontend/index.html`):
- Has a fuller social card than the landing (ironically), but with the wrong URLs (above).
- No canonical, no robots meta. Recommendation: **noindex the app shell** and let the landing be
  the one indexed surface (the app shell is an empty vault screen with nothing to rank; it can
  only compete with the landing for the brand query).

### 1.4 Trust / E-E-A-T surface (P1–P2, big for YMYL)

Mental health is core YMYL: Google and AI engines apply their strictest trust standards here, and
"who is behind this" is a citation-eligibility factor.

Missing entirely:
- **A privacy policy page.** A privacy-first product without a linkable privacy policy is both an
  E-E-A-T gap and a credibility gap (reviewers and directories ask for it first).
- **An about/maker page** (who builds Wymber, why; the entity AI engines can anchor to).
- **Contact** (even just an email + GitHub issues link).
- **HSTS** on both hosts (no `Strict-Transport-Security` header; for an anti-phishing posture per
  ADR-0003 this should be on, eventually preloaded).
- `/.well-known/security.txt` (cheap, on-brand trust signal for a security-claiming product).

Already strong (worth saying): the sources page is real E-E-A-T material (cited research shaping
the product), the disclaimers ("not therapy") are exactly what YMYL raters want, the repo is
public, and the crisis resources are prominent. These are differentiators most competitors fake.

### 1.5 Content & language gap (P2, the make-or-break)

- The landing **never says "trauma"** (only the app's `<title>` does: "Private Trauma Mapping").
  The gentle voice is right for users *on* the page, but engines and LLMs connect entities to
  categories through words. Today nothing tells a machine that Wymber belongs to "trauma mapping
  tool", "trauma egg / trauma timeline alternative", "private journaling app", "local-first
  mental health app".
- One page can't win query fan-outs. When someone asks an assistant "is there a private app to
  map trauma where data stays on my device?", the engine fans out into sub-queries (private
  trauma mapping app, local-first journal, trauma egg digital, encrypted journal no account...).
  Citable, question-shaped pages win those; hero copy doesn't.

### 1.6 What's already excellent (don't touch)

- Vanilla HTML/CSS landing: tiny, fast, fully server-rendered. Core Web Vitals are a non-issue.
- Accessibility-as-architecture doubles as machine readability (the `#map-outline` philosophy).
- GitHub README is a strong, honest artifact (AI engines crawl GitHub heavily).
- The robots **Content-Signal** stance (search=yes, ai-train=no) is the right ethical posture;
  it just needs `ai-input=yes` added and the edge block removed so it actually governs.

---

## 2. What the 2026 landscape actually rewards (research synthesis)

- **Google's official guidance** for AI Overviews / AI Mode: be indexed and snippet-eligible;
  no special markup exists; they explicitly say *don't* bother with llms.txt, chunking, or
  "writing for AI"; unique non-commodity content wins
  ([Google, AI features guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)).
- **GEO consensus** ([Search Engine Land's 2026 guide](https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142),
  [Wikipedia overview](https://en.wikipedia.org/wiki/Generative_engine_optimization)):
  citability beats rankability. Engines cite 2–7 sources per answer; they prefer pages that are
  crawlable without JS, answer one question per section under clear headings, cite sources, show
  freshness, and come from entities they can verify. Off-site mentions (directories, communities,
  comparisons) drive a large share of AI citations.
- **ChatGPT visibility runs through Bing.** OpenAI leans on Bing's index; Bing Webmaster Tools +
  sitemap (+[IndexNow](https://www.indexnow.org/) for fast recrawl) is the practical lever.
- **llms.txt is optional.** ~10% adoption, but measured crawler usage is negligible (one study:
  ~408 llms.txt fetches in 500M AI-bot visits), no provider has committed to it, and Google says
  skip it ([SE Ranking study](https://seranking.com/blog/llms-txt/)). Worth shipping only as a
  cheap courtesy file, never as a strategy.
- **Cloudflare's stack** is the right place to express the policy: managed robots.txt +
  [Content Signals](https://blog.cloudflare.com/control-content-use-for-ai-training/) to state
  preferences, [AI Crawl Control](https://developers.cloudflare.com/ai-crawl-control/) to enforce
  per-bot (allow search/retrieval, block training), instead of the blunt zone-wide block that's
  on today.
- **YMYL/E-E-A-T**: mental-health sites saw the most volatility in 2026 core updates; visible
  authorship, privacy policy, citations, and disclaimers are now citation-eligibility factors for
  AI answers, not just rankings.

---

## 3. The plan (prioritized)

### P0 — Turn visibility on (hours, biggest single win)

1. **Replace the zone-wide AI block with per-bot policy.** In Cloudflare (Security → Bots or AI
   Crawl Control): *allow* OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
   PerplexityBot, Perplexity-User, Applebot (search); *keep blocking* GPTBot, ClaudeBot, CCBot,
   Google-Extended, meta-externalagent, Bytespider. This preserves "no training" while becoming
   citable. (API field today: `ai_bots_protection: "block"` → granular.)
2. **Ship real `robots.txt` files** in both Pages projects (landing dir + `build-pages.mjs`),
   expressing the same policy plus `Content-Signal: search=yes, ai-input=yes, ai-train=no` and a
   `Sitemap:` line. Cloudflare's managed block will then merge with a sane origin file instead of
   HTML soup. Keep training-bot Disallows; do **not** disallow the search/user bots.
3. **Add `404.html`** to the landing Pages project (kills the soft-404s). Add one to the app
   project too.
4. **Register Google Search Console + Bing Webmaster Tools** (DNS verification via the
   Cloudflare token is scriptable), submit the sitemap to both. Bing is the ChatGPT lever.
5. **Fix the app's social card**: `og:url` → `https://web.wymber.app/`, `og:image` →
   `https://web.wymber.app/static/og-image.png`; add `noindex` to the app shell so the landing is
   the canonical public surface.

### P1 — On-page + trust hardening (a day)

6. Landing `<head>`: canonical, og:image (1200×630; design one with the dots motif + tagline
   "Put down a dot, connect the dots"), og:site_name, twitter:card, and JSON-LD:
   `Organization` (logo, `sameAs`: GitHub, Mastodon, Bluesky, Threads, Instagram) +
   `WebSite` + `SoftwareApplication` (free, web, HealthApplication category). Not required for AI
   features, but it builds the entity record everything else hangs off.
7. **Privacy policy page** (plain-language; the product's strongest claim deserves its own URL),
   **About page** (maker entity), contact line in the footer. These are YMYL table stakes and
   they're honest content Wymber actually has.
8. **HSTS** on (then preload later), `/.well-known/security.txt`. Consider basic CSP in
   `_headers` (ADR-0003 alignment; also a trust signal reviewers check).
9. `sitemap.xml` (landing pages + future content), referenced from robots.txt.

### P2 — Become citable (the real game, ongoing)

10. **Bridge the vocabulary gap on the landing** without breaking the voice: one short section or
    FAQ ("Is Wymber a trauma mapping tool?", "Where is my data stored?", "Is this therapy?") that
    uses the category terms (trauma mapping, trauma timeline/trauma egg, local-first, encrypted,
    no account) in honest sentences. FAQ JSON-LD on top.
11. **A small library of question-shaped pages**, grown from `docs/research` + the sources page
    (the research is already done, which is rare): e.g. "What is trauma mapping?" (lineage: the
    trauma egg / Murray method → digital), "How Wymber encrypts your map (and why we can't read
    it)", "Local-first: why your mental-health data shouldn't live on someone's server",
    "Trauma-informed design, applied". Each: one H1 question, sourced claims, visible
    last-updated date, named author, Article JSON-LD. These are the pages assistants will cite.
12. **Earned, third-party presence** (where AI answers actually pull from): GitHub README (done),
    AlternativeTo, Product Hunt when out of alpha, privacy-tool directories, local-first community
    lists, a Show HN. **Ethics rail:** always as the disclosed maker, never astroturfing,
    *especially* in mental-health communities; no incentivized reviews; no AI-generated content
    farms; never overclaim therapeutic benefit (it's also what keeps Wymber safe through YMYL
    core-update volatility).
13. Optional, cheap: a small honest `llms.txt` (product one-liner + links to the privacy page,
    sources, repo). Negligible crawler usage, but costs five minutes and some agents do read it.

### P3 — Measure (so this stays true)

14. Cloudflare **AI Crawl Control analytics** (which AI bots fetch what) + Search Console + Bing
    Webmaster as the dashboard trio. Cloudflare Web Analytics (cookieless) if page-level data is
    wanted without betraying the no-telemetry stance (it's site-level, not in-app).
15. Monthly: ask ChatGPT/Claude/Perplexity/Gemini the money questions ("private app to map
    trauma…", "trauma egg app", "local-first journal encrypted") and log who gets cited. That's
    the GEO scoreboard; expect movement only after P0+P2 land.

---

## 4. The ethical posture, stated once

- **Allow citation, decline training**: `search=yes, ai-input=yes, ai-train=no`, enforced
  per-bot, stated in robots.txt. Wymber gets found; its words don't get absorbed into weights.
- **Nothing user-generated is at stake**: vault content is client-side ciphertext; crawlers can
  only ever see the marketing/docs surface. The privacy promise and GEO don't conflict.
- **No cloaking, no AI-spam, no fake community presence, no medical overclaiming.** Every
  recommended page is content Wymber can stand behind, with sources, which is also exactly what
  the 2026 engines reward. Organic tomatoes.

## Sources

- [Google: AI features and your website](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Search Engine Land: Mastering GEO in 2026](https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142)
- [Wikipedia: Generative engine optimization](https://en.wikipedia.org/wiki/Generative_engine_optimization)
- [Cloudflare: AI Crawl Control](https://developers.cloudflare.com/ai-crawl-control/) · [managed robots.txt](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/) · [Content Signals announcement](https://blog.cloudflare.com/control-content-use-for-ai-training/)
- [OpenAI bots](https://platform.openai.com/docs/bots) · [Anthropic crawlers](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) · [Perplexity bots](https://docs.perplexity.ai/guides/bots)
- [SE Ranking: llms.txt adoption study](https://seranking.com/blog/llms-txt/)
- [IndexNow](https://www.indexnow.org/) · [Bing IndexNow](https://www.bing.com/indexnow)

*Live checks performed 2026-06-11: robots.txt/sitemap/llms.txt/404 behavior on both hosts, AI-UA
403 tests, og-image content-type, response headers, and the zone `bot_management` API read.*
