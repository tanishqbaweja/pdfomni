const params = new URLSearchParams(window.location.search);
const embedded = params.get('embedded') === '1';

function applyTheme(theme) {
  if (!['light', 'dark'].includes(theme)) return;
  document.documentElement.dataset.theme = theme;
}

function reportHeight() {
  if (!embedded || window.parent === window) return;
  window.parent.postMessage({
    type: 'pdfomni-pdf-to-word-height',
    height: Math.ceil(document.documentElement.scrollHeight),
  }, window.location.origin);
}

if (embedded) {
  document.documentElement.classList.add('pdfomni-embedded');
  window.addEventListener('load', reportHeight);
  new ResizeObserver(reportHeight).observe(document.body);
}

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'pdfomni-theme') applyTheme(event.data.theme);
});
