(() => {
  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Element #${id} not found`);
    return element as T;
  };

  const screens = {
    loading: byId<HTMLElement>('screen-loading'),
    form: byId<HTMLElement>('screen-form'),
  };

  const limitInput = byId<HTMLInputElement>('limit-input');
  const formError = byId<HTMLParagraphElement>('form-error');
  const formEyebrow = byId<HTMLElement>('form-eyebrow');
  const formTitle = byId<HTMLElement>('form-title');
  const btnLogout = byId<HTMLButtonElement>('btn-logout');
  const version = byId<HTMLElement>('version');
  const seriesButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.series__button'),
  );
  const seriesItems = seriesButtons.map((button) => ({
    button,
    url: button.dataset.url ?? '',
  }));

  let state: KpSettingsState | null = null;
  let selectedIndex = 0;

  function show(name: keyof typeof screens): void {
    for (const [key, element] of Object.entries(screens)) {
      element.hidden = key !== name;
    }
  }

  function setError(message: string | null): void {
    formError.textContent = message ?? '';
    formError.hidden = message === null;
  }

  function render(): void {
    if (!state) return;

    limitInput.value = String(state.episodeLimit);
    formEyebrow.textContent = state.mode === 'start' ? 'Перед началом' : 'Настройки';
    formTitle.textContent =
      state.mode === 'start' ? 'Что смотрим?' : 'Настройки просмотра';

    renderSeries();
    setError(null);
    show('form');
  }

  function renderSeries(): void {
    for (const [index, item] of seriesItems.entries()) {
      item.button.classList.toggle('series__button_active', index === selectedIndex);
    }
  }

  async function refresh(): Promise<void> {
    state = await window.kp.getState();
    version.textContent = `v${state.appVersion}`;
    const savedIndex = seriesItems.findIndex((item) => item.url === state?.startUrl);
    if (savedIndex >= 0) selectedIndex = savedIndex;
    render();
    limitInput.focus();
  }

  async function startSeries(url: string, trigger: HTMLButtonElement): Promise<void> {
    if (!state) return;
    setError(null);

    const rawLimit = limitInput.value.trim();
    const limit = rawLimit === '' ? Number.NaN : Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 0 || limit > 99) {
      setError('Введите число от 0 до 99');
      return;
    }

    trigger.disabled = true;
    try {
      const result = await window.kp.save({
        episodeLimit: limit,
        startUrl: url,
        updateUrl: state.updateUrl,
        start: true,
      });
      if (!result.ok) {
        setError(result.error ?? 'Не удалось запустить просмотр');
      }
    } finally {
      trigger.disabled = false;
    }
  }

  function selectByUrl(url: string): void {
    const index = seriesItems.findIndex((item) => item.url === url);
    if (index >= 0) {
      selectedIndex = index;
      renderSeries();
    }
  }

  for (const button of seriesButtons) {
    button.addEventListener('click', () => {
      selectByUrl(button.dataset.url ?? '');
      void startSeries(button.dataset.url ?? '', button);
    });
    button.addEventListener('focus', () => {
      selectByUrl(button.dataset.url ?? '');
    });
  }

  document.addEventListener('keydown', (event) => {
    if (!state) return;
    const active = document.activeElement;

    if (active instanceof HTMLElement && active.id === 'btn-logout') return;

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const parsed = Number.parseInt(limitInput.value, 10);
      const base = Number.isFinite(parsed) ? parsed : state.episodeLimit;
      const next = Math.min(99, Math.max(0, base + (event.key === 'ArrowUp' ? 1 : -1)));
      limitInput.value = String(next);
      setError(null);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const length = seriesItems.length;
      if (length === 0) return;
      selectedIndex =
        (selectedIndex + (event.key === 'ArrowRight' ? 1 : -1) + length) % length;
      renderSeries();
      seriesItems[selectedIndex]?.button.focus();
      setError(null);
      return;
    }

    if (event.key === 'Enter') {
      if (active instanceof HTMLElement && active.hasAttribute('data-url')) return;
      event.preventDefault();
      const item = seriesItems[selectedIndex];
      if (item) void startSeries(item.url, item.button);
    }
  });

  btnLogout.addEventListener('click', async () => {
    const confirmed = window.confirm('Выйти из аккаунта Kinopoisk на этом компьютере?');
    if (!confirmed) return;
    const result = await window.kp.logout();
    if (result.ok) {
      await refresh();
    } else {
      setError(result.error ?? 'Не удалось выйти из аккаунта');
    }
  });

  void refresh().catch((error: unknown) => {
    console.error('[settings] failed to load state', error);
    show('form');
  });
})();
