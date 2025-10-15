/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.txt$/i,
      type: 'asset/source'
    });
    return config;
  }
};

export default nextConfig;
