<div align="center">
  <img src="public/freeting-logo.svg" alt="FREETING" width="480" />

  <br />

  [![MIT License](https://img.shields.io/badge/License-MIT-D4AF37?style=flat-square)](LICENSE)
  [![LGPD Compliant](https://img.shields.io/badge/LGPD-Lei%2013.709%2F2018-0B57D0?style=flat-square)](SECURITY.md)
  [![Contributing](https://img.shields.io/badge/PRs-Welcome-10B981?style=flat-square)](CONTRIBUTING.md)
</div>

# FREETING — Videoconferências & Gravações Sem Limites

O **FREETING** é uma plataforma moderna de videoconferência, chamadas P2P, agendamento semanal e gravação contínua no navegador, construída para oferecer **reuniões 100% gratuitas, sem exigência de conta/login e sem limite de tempo**.

🔗 **Acesso Público (Domínio Gratuito):** [https://erickfcorrea.github.io/freeting/](https://erickfcorrea.github.io/freeting/)

---

## Principais Funcionalidades

- **Duração de Reunião 100% Ilimitada**: Chamadas individuais ou em grupo sem corte de 60 minutos.
- **Gravador Nativo Ilimitado (`UnlimitedRecorderEngine`)**: Gravação contínua de vídeo e áudio mixado (`MediaRecorder` + `AudioContext` + Câmera Virtual Studio 720p a 30fps) salva localmente no navegador com reprodutor integrado e download imediato em `.webm`.
- **Conformidade Nativa com a LGPD (Lei nº 13.709/2018)**:
  - **Minimização de Dados (Art. 6º, III)**: Sem coleta de cadastro obrigatório, CPF, telefone ou e-mail.
  - **DLP e Mascaramento Automático (Art. 5º, II e Art. 46)**: Proteção em tempo real que mascara CPFs, e-mails e telefones digitados no chat ou falados na transcrição (`src/domain/lgpdCompliance.ts`).
  - **Direitos do Titular (Art. 18)**: Central de Privacidade integrada com exportação de portabilidade em JSON e eliminação instantânea de todos os dados e gravações locais.
- **Assistente de IA & Legendas ao Vivo em Português (`CC`)**: Transcrição em tempo real via Web Speech API, geração de resumos durante a chamada e exportação da Ata em Markdown (`.md`).
- **Design Moderno & Acessibilidade (WCAG 2.2 AA/AAA)**:
  - Alternância entre **Modo Claro**, **Modo Escuro Pro** e **Modo Alto Contraste (WCAG AAA)**.
  - Controle de escala tipográfica (`100%`, `110%`, `120%`), suporte a leitores de tela (`aria-live`) e atalhos globais de teclado.

---

## Atalhos de Teclado na Sala

| Atalho | Ação |
| :--- | :--- |
| `Alt + M` | Ativar / Desativar Microfone |
| `Alt + V` | Ativar / Desativar Câmera |
| `Alt + R` | Iniciar / Parar Gravação |
| `Alt + C` | Alternar Legendas ao Vivo em Português (`CC`) |
| `Alt + H` | Levantar / Abaixar a Mão (`✋`) |
| `?` | Abrir Guia de Atalhos e Acessibilidade |

---

## Como Executar Localmente

```bash
cd freeting
npm install
npm run dev
```

Acesse `http://localhost:3000` no navegador.

---

## Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais informações.
