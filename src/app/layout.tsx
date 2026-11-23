import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FREETING — Videoconferências e Gravações Sem Limites",
  description:
    "Plataforma de videoconferência reconstruída via Engenharia Reversa (REA + Superpowers) inspirada no Google Meet, com tempo de reunião e gravação 100% ilimitados.",
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
