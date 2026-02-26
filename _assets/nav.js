(function () {
  const nav = document.querySelector('nav.global-nav[data-generated="ati-modern-nav"]');
  if (!nav) return;

  const toggle = nav.querySelector('.global-nav-toggle');
  const links = nav.querySelector('.global-nav-links');
  if (!toggle || !links) return;

  function setOpen(isOpen) {
    nav.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function closeMenu() {
    setOpen(false);
  }

  toggle.addEventListener('click', function () {
    setOpen(!nav.classList.contains('is-open'));
  });

  links.addEventListener('click', function (event) {
    const target = event.target;
    if (target && target.closest('a.global-nav-link')) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });

  document.addEventListener('click', function (event) {
    if (!nav.classList.contains('is-open')) return;
    if (!nav.contains(event.target)) {
      closeMenu();
    }
  });
})();
