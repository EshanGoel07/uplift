import { defineConfig, devices } from '@playwright/test';

// Tests run against the production build served under a sub-path (/uplift/), like GitHub Pages.
// Set E2E_URL (ending in /) to test a deployed site instead, e.g. the Vercel URL.
const remote = process.env.E2E_URL;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: remote ?? 'http://localhost:4173/uplift/',
    // Hardware GL on Windows (D3D11); SwiftShader elsewhere so CI without a GPU still gets WebGL.
    launchOptions: {
      args: process.platform === 'win32'
        ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: remote ? undefined : {
    command: 'npm run preview',
    url: 'http://localhost:4173/uplift/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
