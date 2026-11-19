(() => {
  const root = document.documentElement;
  const isThemeMode = (value) => value === 'system' || value === 'light' || value === 'dark';
  let mode = 'light';
  let skin = 'default';
  try {
    const settings = JSON.parse(localStorage.getItem('rhwp-settings') || '{}');
    const storedMode = settings && settings.theme && settings.theme.mode;
    if (isThemeMode(storedMode)) mode = storedMode;
    const storedSkin = settings && settings.theme && settings.theme.skin;
    if (storedSkin === 'flat' || storedSkin === 'oldschool') skin = storedSkin;
  } catch {
    mode = 'light';
  }
  if (skin !== 'default') root.dataset.themeSkin = skin;
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = mode === 'dark' || (mode === 'system' && prefersDark) ? 'dark' : 'light';
  const scheme = `only ${effective}`;
  root.dataset.themeMode = mode;
  root.dataset.themeEffective = effective;
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
