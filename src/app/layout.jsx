import '@/index.css';

export const metadata = {
  title: 'HeyChat',
  description: 'Private messaging. No phone number. No email. Just you.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'HeyChat',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport = {
  themeColor: '#0D0D12',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
