import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope"
});

export const metadata: Metadata = {
  title: "RemoteJobOS",
  description: "Find remote jobs, tailor verified CVs, apply automatically, and track outcomes."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("remotejobos-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}else if(matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.dataset.theme="dark"}}catch(e){}'
          }}
        />
      </head>
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
