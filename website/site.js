// The year in the footer.
for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());
