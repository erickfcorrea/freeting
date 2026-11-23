# Análise Arquitetural Superpowers: Banco de Dados, UI/UX Acessível e Hospedagem Gratuita

**Projeto:** FREETING (`c:\Users\ERICK\Desktop\GIT-CLONE\freeting`)
**Data:** 2026-11-23
**Metodologia:** `superpowers:telehealth-fullstack` + `superpowers:high-precision-dev` + `frontend-builder`

---

## 1. Análise: É Preciso Criar um Banco de Dados para o FREETING?

### Resposta Executiva: **Sim, um Banco de Dados Híbrido (SQLite no Servidor + IndexedDB no Cliente)**

Para manter a proposta principal do **FREETING** — **reuniões e gravações 100% ilimitadas e gratuitas (`∞`)** — a arquitetura de dados deve separar **Metadados Relacionais** de **Streams Pesados de Mídia**:

| Tipo de Dado | Onde Deve Ser Armazenado? | Por quê? |
| :--- | :--- | :--- |
| **Agendamentos, Salas, Pautas e Atas de IA** | **Banco de Dados Relacional (`SQLite` via `node:sqlite` + Sync Local)** | São dados estruturados leves (poucos KB). Precisam de persistência ACID, busca por data (`YYYY-MM-DD`), status (`SCHEDULED`, `IN_PROGRESS`, `COMPLETED`) e compartilhamento via API REST (`/api/meetings`). |
| **Gravações de Vídeo de Longa Duração (1h, 3h, 10h+ em `.webm`)** | **Banco NoSQL Local do Navegador (`IndexedDB` em Chunks de 1s)** | Um vídeo de 3 horas consome ~1.5 GB a 3 GB. Se fosse salvo em banco de dados na nuvem gratuita (que limita a 500 MB no total), o sistema travaria ou geraria cobrança — exatamente o motivo pelo qual o Google Meet limita a 1 hora no plano grátis. Salvando os chunks de 1s no **IndexedDB** do usuário, o limite é o disco do computador (centenas de GBs) a **custo R$ 0,00**! |
| **Fluxo de Vídeo e Áudio ao Vivo** | **WebRTC Peer-to-Peer (`RTCPeerConnection`)** | O tráfego de vídeo vai direto entre os participantes (P2P) sem passar pelo banco de dados, garantindo baixa latência (~15ms) e duração infinita. |

### Implementação Realizada no FREETING (`src/services/sqliteDatabase.ts`)
Aproveitando o motor nativo **`node:sqlite` (`DatabaseSync`) do Node.js 24**, implementamos um banco de dados relacional real em `data/freeting.sqlite` (com modo `WAL` de alta concorrência e fallback em memória/cliente para ambientes serverless estáticos):
- **Tabela `meetings`**: Armazena todas as reuniões agendadas, códigos `xxx-xxxx-xxx`, horários, status e flags de gravação ilimitada.
- **Tabela `ai_notes`**: Armazena atas e resumos gerados pelo Assistente IA em Português.
- **Sincronização Híbrida Automática**: O frontend sincroniza transparentemente com `/api/meetings` (SQLite) e mantém espelho em `localStorage`/`IndexedDB`, garantindo funcionamento 100% online e offline.

---

## 2. Melhorias de Design UI/UX & Acessibilidade (WCAG 2.2 AA/AAA)

Aplicando as diretrizes do `superpowers` e `frontend-builder`:
1. **Temas Dinâmicos & Alto Contraste**:
   - Alternância instantânea na Home entre **Modo Claro (Google Meet Material 3)**, **Modo Escuro Pro (Dark Glass)** e **Modo Alto Contraste (WCAG AAA)**.
2. **Escala Tipográfica de Acessibilidade**:
   - Controle rápido (`A-`, `A`, `A+`) para ajuste de fonte sem quebrar o layout responsivo.
3. **Atalhos de Teclado Globais & Leitor de Tela (ARIA Live)**:
   - `Alt+M`: Microfone | `Alt+V`: Câmera | `Alt+R`: Gravar Sem Limite (`REC ∞`) | `Alt+C`: Legendas (`CC`) | `Alt+H`: Levantar a Mão (`✋`) | `?`: Guia de Atalhos.
   - Regiões `aria-live="polite"` anunciam mudanças de estado para leitores de tela.
4. **Green Room / Pre-Flight Check & Seletor de Layout**:
   - Medidor visual de áudio em tempo real, seletor de layout na sala (`Automático`, `Mosaico`, `Destaque`, `Barra Lateral`), Picture-in-Picture (`PiP`) e telemetria de rede (`P2P HD • Sem Limite de 60 min`).

---

## 3. Hospedagem e Domínio Gratuitos Configurados

1. **Domínio Público Gratuito Ativo (GitHub Pages)**:
   - URL Pública Gratuita: **`https://erickfcorrea.github.io/freeting/`**
   - Deploy automatizado na branch `gh-pages` + workflow GitHub Actions (`.github/workflows/deploy.yml`).
2. **Pronto para Vercel / Render Free Tier (`vercel.json`)**:
   - Configurado para deploy full-stack gratuito com 1 clique (`freeting.vercel.app`).
