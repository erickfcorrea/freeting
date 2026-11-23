# Política de Segurança e Conformidade LGPD — FREETING

O **FREETING** foi desenvolvido seguindo os princípios de **Privacy by Design** e **Security by Default**, em conformidade com a **Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)** e o **Marco Civil da Internet (Lei nº 12.965/2014)**.

## Compromissos de Privacidade e Proteção de Dados

1. **Ausência de Cadastro Obrigatório (Minimização — Art. 6º, III da LGPD)**:
   - A plataforma não exige criação de conta, coleta de CPF, telefone ou endereço de e-mail para criar ou participar de reuniões.
2. **Processamento Local e P2P**:
   - Os fluxos de áudio e vídeo trafegam via **WebRTC Peer-to-Peer (DTLS-SRTP)** e as gravações ficam armazenadas exclusivamente no dispositivo local do próprio usuário.
3. **Direitos do Titular (Art. 18 da LGPD)**:
   - O usuário possui controle total para visualizar, exportar (portabilidade) ou eliminar permanentemente todos os dados locais, agendamentos e gravações diretamente na **Central de Privacidade LGPD** da plataforma.
4. **Sanitização e Mascaramento de Dados Sensíveis (DLP)**:
   - O módulo `src/domain/lgpdCompliance.ts` oferece mascaramento automático de CPFs, e-mails e telefones em transcrições, atas e mensagens de chat, além de bloqueio de dados sensíveis em logs.
