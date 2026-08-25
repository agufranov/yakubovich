/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@bankrot/shared',
    '@bankrot/storage',
    '@bankrot/connector-core',
    '@bankrot/connector-gis-torgi',
  ],
};
export default nextConfig;
