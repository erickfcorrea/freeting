# REA Reverse Engineering Evidence & Architecture Dossier: Google Meet -> FREETING

**Target Application:** Google Meet Web (`https://meet.google.com/home` & `https://meet.google.com/[room-code]`)
**Reconstructed Project:** **FREETING** (`c:\Users\ERICK\Desktop\GIT-CLONE\freeting`)
**Methodology:** REA (Reverse Engineer Anything) Web Surface & Bundle Observation + Superpowers Full-Stack Engineering Workflow

---

## 1. Executive Summary & Reverse-Engineered Findings

Using the **REA** investigation workflow alongside visual and structural evidence from `meet.google.com/home?pli=1` and `meet.google.com/amd-wraw-qkg?pli=1`, we decomposed Google Meet into four primary subsystems:

1. **Routing & Room Identity Layer (`xxx-xxxx-xxx`)**:
   - Meet uses 10-letter lowercase alphabetic room codes segmented as `3-4-3` (e.g., `amd-wraw-qkg`), excluding visually ambiguous characters where appropriate, and resolves both full URLs (`https://.../amd-wraw-qkg`) and raw codes in the home join input.
2. **Home & Scheduling Dashboard (`/`)**:
   - **Header Bar**: Brand logo + `FREETING` wordmark, central pill input (`#f1f3f4`) with keyboard icon (`"Digite um código ou link"`) and embedded `"Participar"` button, Material 3 tonal green `"+ Nova"` button (`#c4eed0` bg, `#0f5223` text), Material 3 tonal blue `"Anotações feitas por IA"` button (`#d3e3fd` bg, `#041e49` text), and utility action icons (Help, Settings/Pre-flight Diagnostics, Apps grid, User profile avatar).
   - **Left Navigation Rail**: Compact vertical rail with pill indicators (`#c2e7ff`) for `"Reuniões"`, `"Ligações"`, and in FREETING an additional `"Gravações ∞"` vault.
   - **Interactive 7-Day Calendar Strip**: Displays current localized date (`"seg., 23 de nov."`) with date picker trigger and a 7-day horizontal strip (`DOM` through `SÁB`) with circular active day highlight (`#a8c7fa`) and week navigation chevrons (`<` / `>`).
   - **Security Banner**: Rounded tonal blue banner (`#e8f0fe`) with shield-lock icon, host permission notice, and `"Saiba mais"` modal trigger.
   - **Agenda / Empty State**: Custom SVG illustration (steaming cup, pencil, video tablet, sun) with `"Nenhuma reunião agendada para hoje"`, subtitle `"Agende uma reunião ou aproveite seu tempo livre"`, and primary `"+ Nova"` CTA, switching dynamically to scheduled meeting cards when events exist for the selected date.
3. **Active Meeting Room (`/room/[code]`)**:
   - **Dark Material 3 Shell (`#131314` / `#202124`)**: Maximizes contrast for video streams.
   - **Top Telemetry Bar**: Current clock (`18:32`), room code (`amd-wraw-qkg`), info button, **FREETING Unlimited Duration Counter (`00:00:00 • ∞ Sem Limite`)**, active recording indicator, participant badge, and studio effects toggle.
   - **Main Video Stage (`#1b3a6b` navy surface, `16px` border-radius)**:
     - Responsive multi-peer WebRTC grid (1 to 16+ tiles) with active-speaker border highlight, pin-to-stage, fullscreen, and audio level rings.
     - Camera-off state displays centered circular avatar with hover action pill (expand, spotlight, more options) and top-right muted microphone badge (`#1a73e8` / `#3c4043`).
     - **Onboarding Overlay (`"Sua reunião está pronta"`)**: Floating bottom-left white card (`#ffffff`) with `"+ Adicionar outras pessoas"` blue pill (`#0b57d0`), shareable room link box with one-click copy, and teal highlight popover (`"Novo: Já disponível em Português — Agora você pode fazer perguntas ao Assistente IA e gravar sem limite de 1 hora"`).
   - **Bottom Control Bar**:
     - **Left**: `"Pedir para IA..."` (`Somente você`) collapsible AI assistant prompt bar.
     - **Center**: Split Mic pill (device chevron + mute toggle with status badge), Split Camera pill (device chevron + video toggle with status badge), Screen Share (`Apresentar agora`), **Unlimited Recorder (`Gravar ∞`)**, Emoji Reactions (`😊`), Live Captions (`CC` pt-BR), Raise Hand (`✋`), More Options (`⋮`), and End Call (`📞` red wide pill `#ea4335`).
     - **Right**: Side-drawer toggles for Meeting Info `(i)`, People & Waiting Room (`👥`), In-call Chat (`💬`), Activities & Recordings Vault (`❖`), and Host Security Controls (`🔒`).

---

## 2. Eliminating Google Meet's Architectural Limits in FREETING

| Capability | Google Meet (Free Tier) | FREETING (Reconstructed & Enhanced) |
| :--- | :--- | :--- |
| **Group Meeting Duration** | Hard limit of **60 minutes** (disconnects all peers at 1h) | **100% Unlimited (`∞`)** — Zero session cutoff timers; automatic WebRTC heartbeat & seamless token refresh |
| **Meeting Recording** | Locked behind paid Workspace Enterprise tiers & server caps | **100% Free & Unlimited Duration** — Chunked `MediaRecorder` + Web Audio mixer + IndexedDB streaming persistence |
| **Multi-Track Audio Mixing** | Server-side only | Client-side `AudioContext` mixing local microphone + remote WebRTC streams + system screen-share audio |
| **Live Transcription & AI Notes** | Paid Gemini Workspace add-on | Built-in Web Speech API (`pt-BR`) live captions + instant AI Meeting Notes & Markdown/JSON transcript export |
| **RAM Safety on Long Recordings** | N/A | Continuous 1-second chunk flushing to IndexedDB (`freeting-recordings-store`) with zero memory bloat over multi-hour calls |
