import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GA4 privacy-safe page views', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete window.gtag;
    delete window.dataLayer;
    document.head.querySelectorAll('script[data-ffcs-ga]').forEach(script => script.remove());
  });

  it('emits only allowlisted route metadata and no account or timetable identifiers', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    vi.resetModules();
    const { trackPageView } = await import('./analytics');
    const calls: unknown[][] = [];
    window.gtag = (...args: unknown[]) => { calls.push(args); };
    trackPageView('builder');
    expect(calls).toEqual([
      ['js', expect.any(Date)],
      ['config', 'G-TEST123', expect.objectContaining({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false })],
      ['event', 'page_view', { page_title: 'Timetable builder', page_path: '/app/timetable-builder', page_location: `${window.location.origin}/app/timetable-builder` }],
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/user-a|@|CSE\d|timetable contents/i);
    expect(JSON.stringify(calls)).not.toContain('email');
    expect(JSON.stringify(calls)).not.toContain('uid');
    expect(JSON.stringify(calls)).not.toContain('selectedOfferings');
  });
});
