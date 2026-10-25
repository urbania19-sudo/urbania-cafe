import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  allowedDevOrigins: [
    '192.168.1.22',
    '192.168.1.22:3000',
    '192.168.1.8',
    '192.168.1.8:3000',
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
  ],
};

export default nextConfig;
