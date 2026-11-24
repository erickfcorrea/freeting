# Política de Segurança e Conformidade LGPD — FREETING

O **FREETING** foi desenvolvido seguindo os princípios de **Privacy by Design** e **Security by Default**, em conformidade com a **Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)** e o **Marco Civil da Internet (Lei nº 12.965/2014)**.

## Compromissos de Privacidade e Proteção de Dados

1. **Ausência de Cadastro Obrigatório (Minimização — Art. 6º, III da LGPD)**:
   - A plataforma não exige criação de conta, coleta de CPF, telefone ou endereço de e-mail para criar ou participar de reuniões.
2. **Processamento Local e P2P**:
   - Os fluxos de áudio e vídeo trafegam via **WebRTC Peer-to-Peer (DTLS-SRTP)** e as gravações ficam armazenadas exclusivamente no dispositivo local do próprio usuário.
3. **Escudo de Privacidade na Transmissão de Tela (Art. 6º, VII e Art. 46 da LGPD)**:
   - Proteção Anti-Espelho Infinito (`selfBrowserSurface: "exclude"` e ocultação automática do espelho local) aliada ao **Escudo de Notificações LGPD**, que suprime avisos de chat na tela do apresentador para evitar exposição involuntária de mensagens durante apresentações.
4. **Direitos do Titular e Registro ROPA (Art. 18 e Art. 37 da LGPD)**:
   - O usuário possui controle total para visualizar as operações de tratamento, exportar (portabilidade JSON) ou eliminar permanentemente todos os dados locais, agendamentos e gravações diretamente na **Central de Privacidade LGPD** da plataforma.
5. **Sanitização e Mascaramento de Dados Sensíveis (DLP)**:
   - O módulo `src/domain/lgpdCompliance.ts` aplica mascaramento automático de CPFs, CNPJs, cartões bancários, e-mails e telefones em transcrições, atas exportadas, assistente IA e mensagens de chat, além de bloqueio integral de dados sensíveis em logs.
