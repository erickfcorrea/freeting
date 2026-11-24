# Política de Segurança da Informação e Conformidade LGPD — FREETING

O **FREETING** foi projetado sob os princípios de **Privacy by Design**, **Zero-Trust Client Input** e **Security by Default**, em conformidade com a **Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)**, as orientações técnicas da **ANPD** e as recomendações **OWASP Top 10**.

---

## 1. Medidas Técnicas de Segurança de Código e Rede (Art. 46 da LGPD & OWASP)

1. **Cabeçalhos Estritos de Segurança HTTP (`next.config.ts`)**:
   - **Content-Security-Policy (CSP)**: restringe origens de scripts, conexões WebSocket/WebRTC, mídias e workers, bloqueando `object-src 'none'`, `frame-ancestors 'none'` e injeções externas (XSS / Clickjacking).
   - **Strict-Transport-Security (HSTS)**: força comunicação cifrada em HTTPS (`max-age=63072000; includeSubDomains; preload`).
   - **Isolamento & Privacidade de Navegação**: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-DNS-Prefetch-Control: off`, `Cross-Origin-Opener-Policy: same-origin-allow-popups` e supressão de cabeçalho `X-Powered-By`.
   - **Permissions-Policy**: restringe câmera, microfone e captura de tela exclusivamente à própria origem (`self`), bloqueando geolocalização, USB e pagamentos.

2. **Entropia Criptográfica Segura (`CSPRNG` — Mitigação `CWE-338`)**:
   - Códigos de sala e identificadores de participantes são gerados via **Web Crypto API (`crypto.getRandomValues`)** sem viés estatístico, impedindo adivinhação de salas (*Room Prediction / Zoombombing*).

3. **Segurança no Motor WebRTC & PeerJS (`src/services/webrtcRoomEngine.ts` & `src/domain/securityGuard.ts`)**:
   - **Criptografia de Mídia em Trânsito**: todo tráfego de voz, vídeo e dados P2P utiliza **DTLS-SRTP / SCTP** nativo do protocolo WebRTC.
   - **Anti-Spoofing de Organizador (`CWE-290`)**: comandos administrativos (`ROOM_LOCK_STATE`, `HOST_MUTE_ALL`, `HOST_MUTE_PEER` e `ROSTER_SYNC`) passam por validação criptográfica/estrutural de origem, descartando pacotes forjados por participantes comuns.
   - **Bloqueio Efetivo de Sala (`Anti-Zoombombing`)**: quando o organizador tranca a sala, conexões de mídia e dados de pares desconhecidos são recusadas imediatamente na camada de transporte (`ROOM_LOCKED_REJECT`).
   - **Validação de Esquema, Anti-Prototype Pollution & Anti-DoS Flood**: todo pacote recebido via DataChannel/BroadcastChannel passa por whitelist de campos, truncamento seguro, remoção de caracteres de controle/overrides Unicode e *Sliding Window Rate Limiter* com corte automático de conexões abusivas.
   - **Modo de Privacidade de IP (`Relay TURN` — Art. 46)**: opção integrada para rotear candidatos ICE exclusivamente via relay TURN (`iceTransportPolicy: "relay"`), ocultando o endereço IP residencial/móvel do participante perante terceiros.

4. **Proteção de Fronteira de API e Persistência (`src/app/api/meetings/route.ts`)**:
   - Defesa **CSRF (`Same-Origin` / `Sec-Fetch-Site`)** em mutações `POST` e `DELETE`.
   - Limite estrito de payload (`16 KB`), *rate-limiting* em memória com hash FNV-1a não reversível (zero armazenamento de IP) e consultas parametrizadas (*Prepared Statements*) contra SQL Injection, com teto de retenção automática.

---

## 2. Proteção do Titular de Dados (LGPD — Lei nº 13.709/2018)

- **Minimização de Dados (Art. 6º, III)**: plataforma 100% funcional sem exigência de cadastro, conta, senha, CPF, telefone ou e-mail.
- **DLP (Data Loss Prevention) Automático**: mascaramento em tempo real de **CPF, CNPJ, cartões bancários, e-mails e telefones** em mensagens de chat, legendas ao vivo, assistente IA e atas exportadas (`src/domain/lgpdCompliance.ts`).
- **Escudo de Privacidade na Transmissão de Tela**: exclusão automática da própria guia (`selfBrowserSurface: "exclude"`), painel anti-espelho infinito e supressão de notificações privadas na tela do apresentador.
- **Direitos do Titular e ROPA (Art. 18 e Art. 37)**: portabilidade em JSON, registro transparente das operações de tratamento e eliminação imediata de dados locais e gravações sob controle exclusivo do usuário.

---

## 3. Reporte Responsável de Vulnerabilidades

Caso identifique qualquer vulnerabilidade de segurança ou privacidade, abra um relato privado na aba **Security** deste repositório no GitHub para análise e correção prioritária.
