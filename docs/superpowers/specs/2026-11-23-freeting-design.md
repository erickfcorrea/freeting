# FREETING — Design Specification (Superpowers & REA Reconstruction)

**Date:** 2026-11-23
**Project:** FREETING (`c:\Users\ERICK\Desktop\GIT-CLONE\freeting`)
**Methodology:** `superpowers:brainstorming` + `superpowers:telehealth-fullstack` + `REA`

---

## 1. Intent & Why

Google Meet imposes a 60-minute limit on group meetings and restricts native recording to paid tiers. **FREETING** reconstructs the familiar, high-craft Google Meet Material 3 interface (both the Light Home/Scheduling dashboard and the Dark Meeting Room) while completely removing duration limits and adding a crash-resilient, unlimited chunked recording engine (`UnlimitedRecorderEngine`), real-time WebRTC multi-peer rooms, live Portuguese captions, and an integrated AI Meeting Assistant.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Pixel-Faithful Google Meet UX + Material 3 Polish**: Match the exact visual layout from the user's reference screenshots (`meet.google.com/home` and `meet.google.com/amd-wraw-qkg`).
- **Zero Meeting Time Limit (`∞`)**: Calls run indefinitely without any 60-minute forced cutoff, prominently displaying elapsed duration and an `∞ Sem Limite` status badge.
- **Unlimited Multi-Hour Recording Engine**: Record video (camera, screen share, or composite canvas) + mixed multi-participant audio (`AudioContext` destination) using chunked `MediaRecorder` (`timeslice: 1000ms`) backed by IndexedDB storage and instant `.webm` download.
- **Real WebRTC + Multi-Tab / Multi-Peer Signaling**: Work out-of-the-box across multiple browser tabs/windows via `BroadcastChannel` + REST/SSE signaling API, plus an optional **"Simular Participante"** mode so a single user can immediately test multi-participant grid layouts, active speaker detection, waiting room admission, and mixed recording.
- **Full Scheduling & Calendar Strip**: Interactive 7-day calendar strip (`DOM`–`SÁB`), instant meeting creation, "create meeting for later" link generator, and scheduled meetings persisted with UTC timestamps and localized (`America/Sao_Paulo`) presentation.

### Non-Goals
- External proprietary SFU lock-in requiring paid API keys to boot locally.

### Anti-Goals
- Any artificial countdown timer or recording size cap.
- Leaving camera/microphone hardware tracks active after hanging up (`releaseMediaStream` must stop all tracks cleanly).

## 3. Architectural Approaches Considered

1. **Approach A (Selected): Next.js App Router (TypeScript + Tailwind CSS + Native WebRTC + Chunked IndexedDB MediaRecorder + Built-in Signaling API)**
   - *Trade-offs:* Zero external paid dependencies, runs immediately with `npm run dev` / `npm run build`, supports full API routes (`/api/meetings`, `/api/rooms/[code]/signal`, `/api/notes`), and provides 100% control over unlimited recording and WebRTC signaling.
2. **Approach B: External Third-Party SaaS SDK (Daily/Twilio/LiveKit Cloud)**
   - *Rejected:* Introduces external billing/minute quotas that defeat the "unlimited free meetings and recordings" core requirement.

## 4. Core Domain & State Machines

- **`VideoCallState`**: `'DEVICE_CHECK' | 'WAITING_ROOM' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'COMPLETED'`
- **`RecordingState`**: `'IDLE' | 'RECORDING' | 'PAUSED' | 'SAVING'`
- **`MeetingStatus`**: `'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'`
