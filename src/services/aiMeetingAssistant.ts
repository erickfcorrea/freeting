import { RoomCaptionEntry, RoomChatMessage } from "./webrtcRoomEngine";
import { maskPersonalDataInText } from "@/domain/lgpdCompliance";

export interface AiAssistantResponse {
  title: string;
  answer: string;
  actionItems: string[];
  generatedAt: string;
}

export function generateAiMeetingResponse(options: {
  prompt: string;
  roomCode: string;
  elapsedFormatted: string;
  participants: string[];
  captions: RoomCaptionEntry[];
  chatMessages: RoomChatMessage[];
  lgpdMaskEnabled?: boolean;
}): AiAssistantResponse {
  const {
    prompt,
    roomCode,
    elapsedFormatted,
    participants,
    captions,
    chatMessages,
    lgpdMaskEnabled = true,
  } = options;
  const safePrompt = maskPersonalDataInText(prompt.trim(), lgpdMaskEnabled);
  const q = safePrompt.toLowerCase();

  const recentSpeech = captions
    .slice(-10)
    .map(
      (c) =>
        `• ${c.speakerName}: "${maskPersonalDataInText(
          c.text,
          lgpdMaskEnabled
        )}"`
    )
    .join("\n");
  const recentChat = chatMessages
    .filter((m) => m.senderId !== "system")
    .slice(-6)
    .map(
      (m) =>
        `• ${m.senderName}: ${maskPersonalDataInText(m.text, lgpdMaskEnabled)}`
    )
    .join("\n");

  const defaultActionItems = [
    `Disponibilizar o resumo da sala ${roomCode} para os ${participants.length} participante(s).`,
    "Validar os encaminhamentos registrados nas legendas e no chat.",
    "Baixar a ata consolidada em formato Markdown.",
  ];

  if (q.includes("resum") || q.includes("ata") || q.includes("discut")) {
    return {
      title: `Resumo Inteligente • Sala ${roomCode}`,
      answer: [
        `⏱️ Duração em andamento: ${elapsedFormatted}`,
        `👥 Participantes na sala (${participants.length}): ${participants.join(", ")}`,
        recentSpeech
          ? `\n🎙️ Destaques da Fala:\n${recentSpeech}`
          : "\n🎙️ Transcrição pronta para registrar falas em tempo real (ative o botão CC para legendas automáticas).",
        recentChat ? `\n💬 Destaques do Chat:\n${recentChat}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      actionItems: defaultActionItems,
      generatedAt: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  return {
    title: `Assistente IA (Português) • Sala ${roomCode}`,
    answer: `Contexto atual da reunião (${elapsedFormatted} decorridos). Sobre "${safePrompt}":\n\nA sala conta com ${participants.length} participante(s) (${participants.join(", ")}). ${
      captions.length > 0
        ? `Foram registrados ${captions.length} trechos de fala até o momento.`
        : "Você pode ativar a Gravação e as Legendas em Português (CC) na barra de controles a qualquer momento."
    }`,
    actionItems: defaultActionItems,
    generatedAt: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export function exportMeetingMinutesMarkdown(options: {
  roomCode: string;
  elapsedFormatted: string;
  participants: string[];
  captions: RoomCaptionEntry[];
  chatMessages: RoomChatMessage[];
  aiNotes: AiAssistantResponse[];
  lgpdMaskEnabled?: boolean;
}): string {
  const maskEnabled = options.lgpdMaskEnabled ?? true;

  const lines: string[] = [
    `# Ata de Reunião & Transcrição — FREETING`,
    ``,
    `- **Código da Sala:** \`${options.roomCode}\``,
    `- **Duração Registrada:** \`${options.elapsedFormatted}\``,
    `- **Data/Hora de Exportação:** ${new Date().toLocaleString("pt-BR")}`,
    `- **Participantes (${options.participants.length}):** ${options.participants.join(", ")}`,
    `- **Proteção LGPD (Lei nº 13.709/2018):** ${
      maskEnabled
        ? "Mascaramento automático DLP ativo (CPF, CNPJ, e-mail, telefone e cartões protegidos)"
        : "Exportação sob controle direto do usuário"
    }`,
    ``,
    `---`,
    ``,
    `## 1. Anotações Geradas por IA`,
    ``,
  ];

  if (options.aiNotes.length === 0) {
    lines.push(
      `_Nenhuma síntese gerada pelo Assistente IA durante a sessão._`,
      ``
    );
  } else {
    options.aiNotes.forEach((note, idx) => {
      lines.push(`### ${idx + 1}. ${note.title} (${note.generatedAt})`);
      lines.push(maskPersonalDataInText(note.answer, maskEnabled), ``);
      lines.push(`**Próximos Passos:**`);
      note.actionItems.forEach((item) =>
        lines.push(`- [ ] ${maskPersonalDataInText(item, maskEnabled)}`)
      );
      lines.push(``);
    });
  }

  lines.push(`## 2. Transcrição ao Vivo (Português)`);
  lines.push(``);
  if (options.captions.length === 0) {
    lines.push(`_Nenhuma legenda capturada._`, ``);
  } else {
    options.captions.forEach((c) => {
      lines.push(
        `- **[${c.timestamp}] ${c.speakerName}:** ${maskPersonalDataInText(
          c.text,
          maskEnabled
        )}`
      );
    });
    lines.push(``);
  }

  lines.push(`## 3. Histórico do Chat da Reunião`);
  lines.push(``);
  if (options.chatMessages.length === 0) {
    lines.push(`_Nenhuma mensagem no chat._`, ``);
  } else {
    options.chatMessages.forEach((m) => {
      lines.push(
        `- **[${m.timestamp}] ${m.senderName}:** ${maskPersonalDataInText(
          m.text,
          maskEnabled
        )}`
      );
    });
    lines.push(``);
  }

  return lines.join("\n");
}
