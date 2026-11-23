import { RoomCaptionEntry, RoomChatMessage } from "./webrtcRoomEngine";

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
}): AiAssistantResponse {
  const {
    prompt,
    roomCode,
    elapsedFormatted,
    participants,
    captions,
    chatMessages,
  } = options;
  const q = prompt.trim().toLowerCase();

  const recentSpeech = captions
    .slice(-8)
    .map((c) => `• ${c.speakerName}: "${c.text}"`)
    .join("\n");
  const recentChat = chatMessages
    .slice(-5)
    .map((m) => `• ${m.senderName}: ${m.text}`)
    .join("\n");

  const defaultActionItems = [
    `Compartilhar a gravação ilimitada (.webm) da sala ${roomCode} com os ${participants.length} participante(s).`,
    "Revisar os pontos capturados na transcrição ao vivo em português.",
    "Exportar a ata consolidada do FREETING sem cortes de 60 minutos.",
  ];

  if (q.includes("resum") || q.includes("ata") || q.includes("discut")) {
    return {
      title: `Resumo Inteligente FREETING IA • Sala ${roomCode}`,
      answer: [
        `⏱️ Tempo decorrido: ${elapsedFormatted} (Modo Sem Limite ∞ ativo)`,
        `👥 Participantes ativos (${participants.length}): ${participants.join(", ")}`,
        recentSpeech
          ? `\n🎙️ Destaques da Fala:\n${recentSpeech}`
          : "\n🎙️ Transcrição pronta para capturar falas em tempo real (ative o botão CC para legendas automáticas).",
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
    title: `Assistente FREETING IA (Português) • Sala ${roomCode}`,
    answer: `Analisei o contexto da reunião (${elapsedFormatted} decorridos, sem limite de 1 hora). Sobre "${prompt}":\n\nA sala conta com ${participants.length} participante(s) (${participants.join(", ")}). ${
      captions.length > 0
        ? `Foram registrados ${captions.length} trechos de fala até o momento.`
        : "Você pode ativar a Gravação Ilimitada (REC ∞) e as Legendas em Português (CC) na barra inferior a qualquer momento."
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
}): string {
  const lines: string[] = [
    `# Ata de Reunião & Transcrição — FREETING (∞ Sem Limites)`,
    ``,
    `- **Código da Sala:** \`${options.roomCode}\``,
    `- **Duração Registrada:** \`${options.elapsedFormatted}\` (Sem limite de 60 minutos)`,
    `- **Data/Hora de Exportação:** ${new Date().toLocaleString("pt-BR")}`,
    `- **Participantes (${options.participants.length}):** ${options.participants.join(", ")}`,
    ``,
    `---`,
    ``,
    `## 1. Anotações Geradas por IA`,
    ``,
  ];

  if (options.aiNotes.length === 0) {
    lines.push(`_Nenhuma pergunta enviada ao Assistente IA durante a sessão._`, ``);
  } else {
    options.aiNotes.forEach((note, idx) => {
      lines.push(`### ${idx + 1}. ${note.title} (${note.generatedAt})`);
      lines.push(note.answer, ``);
      lines.push(`**Próximos Passos:**`);
      note.actionItems.forEach((item) => lines.push(`- [ ] ${item}`));
      lines.push(``);
    });
  }

  lines.push(`## 2. Transcrição ao Vivo (Português)`);
  lines.push(``);
  if (options.captions.length === 0) {
    lines.push(`_Nenhuma legenda capturada._`, ``);
  } else {
    options.captions.forEach((c) => {
      lines.push(`- **[${c.timestamp}] ${c.speakerName}:** ${c.text}`);
    });
    lines.push(``);
  }

  lines.push(`## 3. Histórico do Chat da Reunião`);
  lines.push(``);
  if (options.chatMessages.length === 0) {
    lines.push(`_Nenhuma mensagem no chat._`, ``);
  } else {
    options.chatMessages.forEach((m) => {
      lines.push(`- **[${m.timestamp}] ${m.senderName}:** ${m.text}`);
    });
    lines.push(``);
  }

  return lines.join("\n");
}
