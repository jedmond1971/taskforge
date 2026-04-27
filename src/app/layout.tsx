import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={`${inter.className} bg-stone-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-150`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
