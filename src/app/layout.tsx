import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FREETING — Videoconferências e Gravações Sem Limites",
  description:
    "Plataforma de videoconferência gratuita com tempo de reunião e gravação 100% ilimitados, WebRTC P2P, legendas ao vivo e assistente de IA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased selection:bg-blue-200 selection:text-blue-900">
        {children}
      </body>
    </html>
  );
}
