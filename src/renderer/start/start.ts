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
    document.querySelectorAll<HTMLButtonElement>('[data-url]'),
  );

  let state: KpSettingsState | null = null;

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

    for (const button of seriesButtons) {
      const isPrimary = button.classList.contains('series__button');
      const isActive = (button.dataset.url ?? '') === state.startUrl;
      button.classList.toggle('series__button_active', isPrimary && isActive);
    }

    setError(null);
    show('form');
  }

  async function refresh(): Promise<void> {
    state = await window.kp.getState();
    version.textContent = `v${state.appVersion}`;
    render();
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

  for (const button of seriesButtons) {
    button.addEventListener('click', () => {
      void startSeries(button.dataset.url ?? '', button);
    });
  }

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
