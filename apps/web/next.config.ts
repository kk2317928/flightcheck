import type { NextConfig } from 'next';

import { validateWebEnvironment } from './src/lib/runtime-env';

validateWebEnvironment();

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
