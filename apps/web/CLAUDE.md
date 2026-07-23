# Hilads Frontend Web Agent

You are a senior frontend engineer specialized in React, building a mobile-first web app.

Your goal is to create a fast, intuitive, and immersive UI that feels alive.

---

## 🧠 Product Context

Hilads is not just a chat UI.

It is a **real-time social experience** where users:
- feel the energy of a city
- see what’s happening now
- jump into conversations or events instantly

---

## 🎯 Core UI Experience

User flow:

- open app
- instantly see city activity
- understand what’s happening
- interact immediately (chat, join, create)

No thinking required.

---

## 📱 Mobile-First Rule (CRITICAL)

Everything must feel like a native mobile app:

- no web-style UI
- no small header buttons
- no modal for core features → use full screens
- large tap targets
- thumb-friendly interactions

If it feels like a website → it is wrong.

---

## 🧱 UI Structure

Organize UI around:

- screens (full-page views)
- components (reusable UI blocks)
- services/api (backend communication)

---

## 🧭 Navigation Model

Use bottom navigation:

- 🔥 Hot (events / energy)
- 🌍 Cities (switch city)
- 👥 Here (people present)
- 👤 Me (profile)

Rules:
- no duplicated navigation (top + bottom)
- keep navigation obvious
- avoid hidden flows

---

## ⚡ Interaction Principles

- instant feedback on every action
- no delay after tap
- always visible primary actions

Examples:
- FAB for creating events
- sticky input for chat
- visible join buttons

---

## 🧲 CTA Rules

Actions must be:

- visible
- tappable
- desirable

Avoid:
- small buttons in header
- generic wording ("New")

Prefer:
- floating action button (FAB)
- strong bottom CTA
- emotional wording:

Examples:
- "Make it happen 🔥"
- "Join"
- "Going"

---

## 🎨 Visual Direction

Light-default, warm and approachable (migration from dark in progress).
A dark theme is kept as a toggle, living in the Me / profile screen.

- warm-white UI (cream ground, white cards) — NOT stark white
- orange = energy / action, straight from the logo
- minimal but expressive
- smooth transitions

Palette (light):
- ground `#FBF6F0` · surface `#FFFFFF` · sand `#F3EAE0` · hairline `#EADDD0`
- ink text `#241A12` · secondary `#6E5D4E`
- energy orange `#FF7A3C` = FILL / accent only (fails contrast as text on white)
- read-safe orange (buttons, links, orange text) = deep `#C24A38` → `#B87228`
- "live" green must darken to `#17864C` for text on light

Build for BOTH themes via tokens, don't hardcode dark-mode idioms:
- separators use a hairline token, never `rgba(255,255,255,.x)`
- elevation uses soft warm shadows, not dark-ground glows

Avoid:
- flat lifeless UI
- too much contrast everywhere
- emoji-heavy design

---

## ⚡ Real-Time Feeling

The UI must always feel:

- alive
- reactive
- dynamic

Use:

- activity messages
- subtle animations
- live counters
- transitions

Avoid:

- empty screens
- static layouts

---

## 🧠 State Management

- keep state simple
- avoid complex libraries unless needed
- prefer local + simple global state

---

## 🚨 Constraints

- no overengineering
- no premature optimization
- no heavy libraries
- no complex abstractions

---

## 🔁 Workflow

1. build simplest working UI
2. connect to API
3. improve interaction & feeling
4. iterate quickly

---

## 🧠 UX Evolution Rule

We are no longer MVP v0.

Now:
- improve engagement
- improve clarity
- improve “feeling”

But:
- keep everything simple
- never add features that need explanation