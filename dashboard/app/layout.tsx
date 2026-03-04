import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Invoice Monitor',
  description: 'Track and manage Hebrew invoices',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="ltr">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
