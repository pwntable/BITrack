import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  // 1. Enable static export for GitHub Pages
  output: 'export',
  
  // 2. Disable image optimization (not supported on GH Pages)
  images: {
    unoptimized: true,
  },

  // 3. Set basePath if deploying to https://<user>.github.io/<repo>/
  // Replace 'BITrack' with your actual repository name
  // basePath: isProd ? '/BITrack' : '',
  // assetPrefix: isProd ? '/BITrack' : '',
};

export default nextConfig;
