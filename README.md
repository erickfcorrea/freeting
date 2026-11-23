# FREETING — Videoconferências & Gravações Sem Limites (`∞`)

> **Reconstrução e Evolução do Google Meet via Engenharia Reversa (`REA: Reverse Engineer Anything`) + Workflow `Superpowers`.**

O **FREETING** recria a experiência visual e funcional do **Google Meet** (Material Design 3, Dashboard de Agendamento Semanal, Sala de Reunião Dark Mode, WebRTC Multi-Peer, Legendas ao Vivo em Português e Assistente de Anotações por IA), eliminando os dois maiores gargalos da versão gratuita do Meet:
1. **Zero Limite de 60 Minutos em Reuniões (`∞ Sem Limite`)**: Chamadas em grupo sem corte de 1 hora.
2. **Gravação Nativa Ilimitada (`UnlimitedRecorderEngine`)**: Gravação contínua em chunks de 1 segundo (`MediaRecorder` + mixer `AudioContext` multi-stream + persistência em `IndexedDB`) sem estourar memória RAM mesmo em reuniões de várias horas, com download instantâneo em `.webm` e exportação da transcrição/ata.

---

## Arquitetura & Documentação de Engenharia Reversa

- [Dossiê de Engenharia Reversa REA (`meet-reverse-engineering-report.md`)](docs/rea-evidence/meet-reverse-engineering-report.md)
- [Especificação Superpowers (`2026-11-23-freeting-design.md`)](docs/superpowers/specs/2026-11-23-freeting-design.md)
- [Plano de Implementação TDD (`2026-11-23-freeting-plan.md`)](docs/superpowers/plans/2026-11-23-freeting-plan.md)

## Como Executar

```bash
npm install
npm test
npm run dev
```

Acesse `http://localhost:3000`.
