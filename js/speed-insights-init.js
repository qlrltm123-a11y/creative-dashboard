/**
 * Vercel Speed Insights Initialization
 * This script initializes Vercel Speed Insights for the static site
 */

// Import the injectSpeedInsights function from the package
import { injectSpeedInsights } from '../node_modules/@vercel/speed-insights/dist/index.mjs';

// Initialize Speed Insights when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectSpeedInsights();
  });
} else {
  // DOMContentLoaded has already fired
  injectSpeedInsights();
}
