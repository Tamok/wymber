# Wymber

**A private, local-first space to map and understand your experiences.**

Wymber is a privacy-first, trauma-informed tool for laying out what happened, how it
connects, and how you're growing, at your own pace, on your own device. It's an active revival
(alpha), open-sourced so its privacy claims can be independently verified.

🌐 **[wymber.app](https://wymber.app)**  ·  📐 [Architecture decisions](docs/adr/)  ·  ⚖️ [AGPL-3.0](LICENSE)

> **Self-help, not medical care.** Wymber is a tool for personal reflection, not therapy,
> diagnosis, or a medical device, and not a substitute for professional care. If you're in crisis,
> see [Crisis resources](#crisis-resources).

## What it is

- **Local-first and private.** Your map lives on your device, encrypted with a key derived from
  your password. There's no account to create and nothing is sent to a server. A printable
  **recovery sheet** means a forgotten password no longer costs you your data.
  See [ADR-0001](docs/adr/0001-local-first-encrypted-file.md).
- **A map, not a form.** Eleven building blocks (Event, Emotion, Body, Person, Place,
  Trigger, Coping, Support, Need, Insight, Growth) connect into a web you can explore, each with an
  optional, non-directive prompt. A discovery engine is planned to surface links you might not have
  seen yet.
- **Trauma-informed by design.** Soft colours, plain language, predictable UI, no jarring motion,
  full keyboard navigation, and WCAG 2.1 AA accessibility as a baseline.

> **Status: active alpha.** The local-first encrypted-vault client is the app. The tiny FastAPI
> server only serves the static files, and is where an optional, future, zero-knowledge sync
> endpoint would live.

## How it's built

- **Frontend:** vanilla JS + ES modules, no build step.
- **Crypto:** envelope encryption (a random AES-256-GCM data key, wrapped per unlock method:
  password, recovery code, later passkeys); PBKDF2 today, Argon2id tracked.
- **Backend (optional, self-host):** a tiny FastAPI app that only serves the static files. No
  database, no accounts.

## Run it (development)

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    |    macOS/Linux: source .venv/bin/activate
pip install -r requirements.lock         # exact, tested versions
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# open http://localhost:8000
```

`requirements.lock` pins exact versions so it builds the same everywhere; `requirements.txt` is the
top-level list you edit.

### Tests

```bash
python -m pytest tests/ -q    # backend
npx vitest run                # frontend unit
npx playwright test           # end-to-end (browser)
```

## Transparency

Wymber is built with heavy AI assistance (Claude Code) as a tool, and **every change is reviewed
and audited by the maintainer ([@tamok](https://github.com/tamok)) before it ships.** The project
is open-source under **AGPL-3.0** for exactly this reason: a privacy tool should be auditable. If a
privacy claim here matters to you, you can read the code that backs it, and verify that
[wymber.app](https://wymber.app) serves exactly that code (see
[ADR-0003](docs/adr/0003-client-integrity-and-anti-phishing.md)).

Open-source also means your data outlives the project. A `.wymber` export is always yours to open
with the public code, even if this site ever disappears.

## Crisis resources

If you're in crisis, please reach out:

- Call or text **988**, the Suicide & Crisis Lifeline (US)
- Text **HOME** to **741741**, the Crisis Text Line
- Call **911** for emergencies

## License

[AGPL-3.0](LICENSE). The copyleft keeps network-deployed forks open; the maintainer may offer an
official hosted or sync product separately.
