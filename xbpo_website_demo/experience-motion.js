(() => {
  const body = document.body;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const pageMap = {
    'index.html': 'home',
    'about.html': 'about',
    'services.html': 'services',
    'process.html': 'process',
    'careers.html': 'careers',
    'contact.html': 'contact',
    'privacy.html': 'privacy',
    'service-final-expense.html': 'final-expense',
    'service-us-outbound.html': 'outbound',
    'service-lead-generation.html': 'lead-generation',
    'service-appointments.html': 'handoff',
    'service-quality.html': 'quality',
    'service-operations.html': 'operations',
    'role-fronter.html': 'role-fronter',
    'role-closer.html': 'role-closer',
    'role-verifier.html': 'role-verifier'
  };

  const file = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  body.dataset.xbpoPage = pageMap[file] || 'home';

  /* No splash / loader and no artificial navigation delay.
     The real header logo and page hero provide the arrival motion. */
  document.querySelectorAll('.xbpo-page-loader').forEach(el => el.remove());

  if (reduce) {
    body.classList.add('xbpo-motion-ready');
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('xbpo-motion-ready')));
  }

  window.addEventListener('pageshow', () => {
    body.classList.remove('xbpo-page-leaving');
    body.classList.add('xbpo-motion-ready');
  });
})();
