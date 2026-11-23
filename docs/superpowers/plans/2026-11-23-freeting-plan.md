# FREETING Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build FREETING, a Google Meet clone and enhancement with unlimited meeting duration, unlimited chunked local/IndexedDB recording, WebRTC multi-peer video rooms, interactive 7-day calendar scheduling, live captions, and AI meeting notes.

**Architecture:** Clean domain-separated full-stack TypeScript application (`src/domain` for room codes, scheduling, state machines, and unlimited recording logic; `src/services` for WebRTC signaling, IndexedDB recording vault, and AI assistant; `src/components` for Google Meet Home and Meeting Room UI; `src/app` for Next.js routes and REST endpoints).

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind CSS, Lucide Icons, Vitest (TDD unit & integration tests), WebRTC (`RTCPeerConnection`, `MediaRecorder`, `AudioContext`, `BroadcastChannel`, `IndexedDB`).

**Spec:** `docs/superpowers/specs/2026-11-23-freeting-design.md`

## Global Constraints

- Room codes MUST follow Google Meet's `xxx-xxxx-xxx` format (`^[a-z]{3}-[a-z]{4}-[a-z]{3}$`) and accept full URLs or raw codes when joining.
- Meeting duration MUST have no upper bound (`maxDurationMs = Infinity`) and never auto-terminate at 60 minutes.
- Recording engine MUST flush media chunks continuously (`timeslice = 1000ms`) and track elapsed duration, byte size, and pause/resume states without memory leaks.
- Leaving a room MUST invoke `releaseMediaStream()` to stop all active audio, video, and screen-share tracks.
- Every major project stage MUST be committed to Git and pushed to GitHub across structured branches (`main`, `feat/rea-reverse-engineering`, `feat/core-domain`, `feat/home-dashboard`, `feat/meeting-room-unlimited`).

## Review Focus

- Joining with a full URL like `https://meet.google.com/amd-wraw-qkg?pli=1` or `freeting.app/amd-wraw-qkg` extracts `amd-wraw-qkg` cleanly.
- Recording for multiple hours accumulates chunks and calculates human-readable file size and `HH:MM:SS` formatting accurately even past `01:00:00` (1 hour+).
- Media track teardown stops every track in both camera stream and screen-share stream on call end.
- Calendar week strip accurately generates the 7-day week (`DOM.` to `SÁB.`) around any selected date and filters meetings for that day.
- Waiting room and host security controls properly gate participant actions when locked.

---

### Task 1: Core Domain Engine (Room Codes, Unlimited Timer & Recorder Math, Calendar & State Machine)

**Files:**
- Create: `src/domain/roomCode.ts`
- Create: `src/domain/unlimitedRecorder.ts`
- Create: `src/domain/calendarSchedule.ts`
- Test: `src/domain/__tests__/freetingDomain.test.ts`

- [x] **Step 1: Write unit tests for room code extraction/generation, 1h+ unlimited duration formatting, chunked recorder state transitions, and 7-day calendar strip calculation**
- [x] **Step 2: Implement `roomCode.ts`, `unlimitedRecorder.ts`, and `calendarSchedule.ts`**
- [x] **Step 3: Verify tests pass and commit to `feat/core-domain`**

### Task 2: Services Layer (IndexedDB Unlimited Recording Vault, WebRTC Multi-Peer + Simulated Peer Engine, AI Notes Service)

**Files:**
- Create: `src/services/recordingVault.ts`
- Create: `src/services/webrtcRoomEngine.ts`
- Create: `src/services/aiMeetingAssistant.ts`

- [x] **Step 1: Implement IndexedDB chunked recording storage & `.webm` downloader**
- [x] **Step 2: Implement WebRTC + BroadcastChannel signaling & simulated participant generator**
- [x] **Step 3: Implement AI Meeting Notes & Live Transcription analyzer**

### Task 3: Google Meet Home Dashboard (`/`)

**Files:**
- Create: `src/components/home/MeetHeader.tsx`
- Create: `src/components/home/LeftNavRail.tsx`
- Create: `src/components/home/WeekCalendarStrip.tsx`
- Create: `src/components/home/NewMeetingMenuModal.tsx`
- Create: `src/components/home/RecordingsVaultModal.tsx`
- Create: `src/app/page.tsx`

- [x] **Step 1: Reconstruct the exact Google Meet Home interface from Screenshot 1 with interactive scheduling, "+ Nova" dropdown, 7-day strip, and Recordings Vault**
- [x] **Step 2: Commit milestone to `feat/home-dashboard`**

### Task 4: Google Meet Active Room & Unlimited Recorder (`/room/[code]`)

**Files:**
- Create: `src/components/room/RoomTopBar.tsx`
- Create: `src/components/room/VideoStage.tsx`
- Create: `src/components/room/ReadyInviteCard.tsx`
- Create: `src/components/room/BottomControlBar.tsx`
- Create: `src/components/room/SideDrawer.tsx`
- Create: `src/app/room/[code]/page.tsx`

- [x] **Step 1: Reconstruct the exact Dark Mode Meeting Room from Screenshot 2 with WebRTC camera/screen-share, Unlimited Chunked Recorder, Live Captions, Reactions, AI Prompt Bar, and Side Drawers**
- [x] **Step 2: Run REA static JavaScript analysis + Vitest + Next.js production build, merge branches, and push all commits to GitHub**
