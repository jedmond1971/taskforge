import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JedForge",
  description: "Project management built for developers",
  icons: {
    icon: [
      { url: "/icons/light/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/light/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icons/light/icon-128.png",
    shortcut: "/icons/light/favicon-32.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${plexSans.className} ${plexMono.variable} bg-background text-foreground transition-colors duration-150`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
