document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'print') window.print();
  if (b.dataset.act === 'back') { if (history.length > 1) history.back(); else window.close(); }
});
