(() => {
  const root = document.documentElement;
  let skin = 'default';
  const isPalette = (value) => value === 'rose' || value === 'espresso';
  let palette = 'rose';
  try {
    const savedPalette = localStorage.getItem('hop-claw-palette');
    if (isPalette(savedPalette)) {
      palette = savedPalette;
    } else {
      const settings = JSON.parse(localStorage.getItem('rhwp-settings') || '{}');
      const storedMode = settings && settings.theme && settings.theme.mode;
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const fallbackDark = storedMode === 'dark' || (storedMode === 'system' && prefersDark);
      palette = fallbackDark ? 'espresso' : 'rose';
    }
    const settings = JSON.parse(localStorage.getItem('rhwp-settings') || '{}');
    const storedSkin = settings && settings.theme && settings.theme.skin;
    if (storedSkin === 'flat' || storedSkin === 'oldschool') skin = storedSkin;
  } catch {
    palette = 'rose';
  }
  if (skin !== 'default') root.dataset.themeSkin = skin;
  const effective = palette === 'espresso' ? 'dark' : 'light';
  const scheme = `only ${effective}`;
  root.dataset.hcPalette = palette;
  root.dataset.themeMode = effective;
  root.dataset.themeEffective = effective;
  root.setAttribute('data-theme', effective);
  root.classList.toggle('dark', effective === 'dark');
  root.style.colorScheme = scheme;

  let toolbarBasic = true;
  let toolbarFormat = true;
  try {
    const settings = JSON.parse(localStorage.getItem('rhwp-settings') || '{}');
    const view = (settings && settings.view) || {};
    if (view.toolbarBasic === false) toolbarBasic = false;
    if (view.toolbarFormat === false) toolbarFormat = false;
  } catch {
    toolbarBasic = true;
    toolbarFormat = true;
  }
  root.dataset.toolboxBasic = toolbarBasic ? 'shown' : 'hidden';
  root.dataset.toolboxFormat = toolbarFormat ? 'shown' : 'hidden';
})();
