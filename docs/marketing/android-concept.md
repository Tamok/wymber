# Wymber — Android App Concept

> **Honest framing:** these are **concepts and wireframes**, not production renders. High-fidelity mockups come after the mobile-stack ADR (issue #11) and the trauma-informed UX work (epic #32). Use these to align on direction and for early marketing visuals (clearly labeled "concept").

## Principles (carried from web, adapted to touch)

- **Local-first on the phone.** Your map lives on the device, encrypted. Sync is optional & paid.
- **One-handed, low-effort, low-arousal.** Big tap targets, generous spacing, gentle motion, no red.
- **Accessibility is architecture** (carries to mobile): TalkBack support, focus order, large-text & reduced-motion honored, AA contrast.
- **Safety within reach.** A persistent, quiet way to reach grounding + crisis resources.
- **You're in control.** Opt-in depth; nothing auto-shared; private on-device AI only if enabled.

## Core screens (concept)

**1. Welcome / unlock**
Calm full-screen. "Your private space." Unlock with device biometric/passcode (the local encryption key is derived locally). One clear "Create your space" for first run, with the *informed* "no recovery" acknowledgement.

**2. The Map (home)**
Pannable/zoomable canvas of soft node bubbles. FAB "+" to add. Long-press a node → gentle radial menu (Edit · Connect · Details). Pinch to zoom; two-finger pan. A small, always-present "Grounding" affordance in a corner.

**3. Add / Edit node (bottom sheet)**
Slides up softly. Type chooser (Event/Emotion/Person/Place/Trigger/Coping/Insight/Growth) as soft chips. Title + optional encrypted description ("private to you"). Big Save.

**4. Node detail**
Full, calm view of one node + its connections, with edit and "see on map."

**5. Reflect / Analyze**
Gentle, non-judgmental summary ("6 experiences, 3 connections, you've added 2 coping strategies"). Never alarming framing.

**6. Settings**
Theme (light/dark/soft), text size, **Sync** (paid, off by default, explained plainly), Export/Backup, Privacy explainer, Crisis resources.

## ASCII wireframes (concept)

```
  Map (home)                      Add node (bottom sheet)
 ┌───────────────────┐           ┌───────────────────┐
 │  Wymber    ⚙   │           │  ░░░░ (dimmed) ░░░ │
 │                   │           │┌─────────────────┐│
 │      (emotion)    │           ││ Add to your map ✕││
 │        \          │           ││ Type:           ││
 │   (event)──(coping)│          ││ [Event][Emotion]││
 │        /          │           ││ [Trigger][Cope] ││
 │   (trigger)       │           ││ Title: ________ ││
 │                   │           ││ Note (private): ││
 │             ╭───╮ │           ││ ______________  ││
 │  ◌ grounding│ + │ │           ││     [ Save ]    ││
 │             ╰───╯ │           │└─────────────────┘│
 └───────────────────┘           └───────────────────┘
   FAB = add node                  soft slide-up, big targets
```

## Marketing usage

- Label any concept image **"concept"** until real builds exist.
- Prefer real screenshots (web today; mobile once built) for credibility.
- Phone-frame the web PWA for an honest "coming to mobile" visual in the interim.
