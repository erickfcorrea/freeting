# Guia de Contribuição — FREETING

Obrigado pelo interesse em contribuir com o **FREETING**!

## Diretrizes Principais

1. **Privacidade e Conformidade LGPD (Lei nº 13.709/2018)**:
   - Todo código deve respeitar o princípio de **Minimização de Dados (Art. 6º, III da LGPD)** e **Privacidade desde a Concepção (Privacy by Design)**.
   - Nunca registre dados pessoais identificáveis (CPF, e-mail, telefone, endereço IP ou conteúdo de áudio/vídeo/chat) em logs de servidor. Utilize sempre os utilitários de sanitização em `src/domain/lgpdCompliance.ts`.
2. **Qualidade de Código & Acessibilidade**:
   - Mantenha a tipagem estrita em TypeScript (`npm run typecheck` sem erros).
   - Preserve os atributos de acessibilidade WCAG 2.2 (`aria-label`, `aria-live`, `role`, navegação por teclado).
3. **Fluxo de Branches e Commits (`homo` → `main`)**:
   - Todo desenvolvimento e novas funcionalidades devem ser comitados e testados na branch de homologação **`homo`**.
   - Após validação completa em **`homo`**, realiza-se o merge para a branch principal **`main`** (produção).
   - Utilize mensagens de commit semânticas (`feat:`, `fix:`, `style:`, `chore:`).

## Como Rodar o Ambiente de Desenvolvimento

```bash
npm install
npm run dev
npm run typecheck
npm run build
```
