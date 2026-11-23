# FREETING — Videoconferências & Gravações Sem Limites (`∞`)

O **FREETING** é uma plataforma moderna de videoconferência, chamadas P2P, agendamento semanal e gravação contínua no navegador, construída para oferecer **reuniões 100% gratuitas e sem limite de tempo**.

🔗 **Acesso Público (Domínio Gratuito):** [https://erickfcorrea.github.io/freeting/](https://erickfcorrea.github.io/freeting/)

---

## Principais Funcionalidades

- **Duração de Reunião 100% Ilimitada (`∞`)**: Chamadas individuais ou em grupo sem corte de 60 minutos.
- **Gravador Nativo Ilimitado (`UnlimitedRecorderEngine`)**: Gravação contínua de vídeo e áudio mixado (`MediaRecorder` + `AudioContext` + compositor Canvas 720p a 30fps) salva em chunks de 1 segundo diretamente no **IndexedDB**, permitindo gravar horas seguidas sem estourar a memória RAM e com download imediato em `.webm`.
- **Banco de Dados Híbrido (`SQLite` + `IndexedDB`)**:
  - **Servidor (`node:sqlite` em modo `WAL`)**: Persistência relacional de agendamentos, salas (`xxx-xxxx-xxx`), pautas e atas em `data/freeting.sqlite`.
  - **Cliente (`IndexedDB` & `localStorage`)**: Sincronização offline-first e cofre local de gravações de longa duração.
- **Assistente de IA & Legendas ao Vivo em Português (`CC`)**: Transcrição em tempo real, geração de resumos durante a chamada e exportação instantânea da Ata completa em Markdown (`.md`).
- **Design Moderno & Acessibilidade (WCAG 2.2 AA/AAA)**:
  - Alternância entre **Modo Claro**, **Modo Escuro Pro** e **Modo Alto Contraste (WCAG AAA)**.
  - Controle de escala tipográfica (`100%`, `110%`, `120%`), suporte a leitores de tela (`aria-live`) e atalhos globais de teclado.

---

## Atalhos de Teclado na Sala

| Atalho | Ação |
| :--- | :--- |
| `Alt + M` | Ativar / Desativar Microfone |
| `Alt + V` | Ativar / Desativar Câmera |
| `Alt + R` | Iniciar / Parar Gravação Ilimitada (`REC ∞`) |
| `Alt + C` | Alternar Legendas ao Vivo em Português (`CC`) |
| `Alt + H` | Levantar / Abaixar a Mão (`✋`) |
| `?` | Abrir Guia de Atalhos e Acessibilidade |

---

## Arquitetura do Projeto

```text
freeting/
├── src/
│   ├── app/
│   │   ├── api/meetings/route.ts       # API REST CRUD conectada ao SQLite
│   │   ├── room/[code]/page.tsx        # Rota dinâmica da Sala de Reunião
│   │   ├── layout.tsx                  # Layout global e metadados
│   │   └── page.tsx                    # Dashboard Inicial e Agenda Semanal
│   ├── components/
│   │   ├── home/                       # Painel Principal, Calendário 7 dias e Cofre
│   │   └── room/                       # Sala WebRTC, Gravador ∞, Chat e IA
│   ├── domain/
│   │   ├── calendarSchedule.ts         # Motor de datas e agendamento semanal
│   │   ├── roomCode.ts                 # Gerador e validador de códigos xxx-xxxx-xxx
│   │   └── unlimitedRecorder.ts        # Máquina de estados de gravação sem limite
│   └── services/
│       ├── aiMeetingAssistant.ts       # Assistente de IA e exportador de Atas (.md)
│       ├── recordingVault.ts           # Gravador chunked MediaRecorder + IndexedDB
│       ├── sqliteDatabase.ts           # Banco de dados relacional nativo (node:sqlite)
│       └── webrtcRoomEngine.ts         # Sinalização WebRTC P2P multi-peer
├── vercel.json                         # Configuração para deploy na Vercel
└── package.json
```

---

## Como Executar Localmente

```bash
cd freeting
npm install
npm run dev
```

Acesse `http://localhost:3000` no navegador.
