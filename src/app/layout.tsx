import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#131314" },
  ],
};

export const metadata: Metadata = {
  title: "FREETING — Videoconferências e Gravações Sem Limites",
  description:
    "Plataforma de videoconferência gratuita com tempo de reunião e gravação 100% ilimitados, WebRTC P2P, legendas ao vivo e assistente de IA.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FREETING",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased selection:bg-blue-200 selection:text-blue-900 overscroll-none">
        {children}
      </body>
    </html>
  );
}
