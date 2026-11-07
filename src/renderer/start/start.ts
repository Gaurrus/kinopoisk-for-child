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

  const settingsForm = byId<HTMLFormElement>('settings-form');
  const limitInput = byId<HTMLInputElement>('limit-input');
  const urlInput = byId<HTMLInputElement>('url-input');
  const formError = byId<HTMLParagraphElement>('form-error');
  const submitButton = byId<HTMLButtonElement>('submit-button');
  const formEyebrow = byId<HTMLElement>('form-eyebrow');
  const formTitle = byId<HTMLElement>('form-title');
  const btnLogout = byId<HTMLButtonElement>('btn-logout');
  const version = byId<HTMLElement>('version');

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
    urlInput.value = state.startUrl;
    formEyebrow.textContent = state.mode === 'start' ? 'Перед началом' : 'Настройки';
    formTitle.textContent =
      state.mode === 'start' ? 'Сколько серий разрешить?' : 'Настройки просмотра';
    submitButton.textContent =
      state.mode === 'start' ? 'Начать просмотр' : 'Сохранить и вернуться';

    setError(null);
    show('form');
  }

  async function refresh(): Promise<void> {
    state = await window.kp.getState();
    version.textContent = 'v0.1.0';
    render();
  }

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state) return;

    setError(null);

    const rawLimit = limitInput.value.trim();
    const limit = rawLimit === '' ? Number.NaN : Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 0 || limit > 99) {
      setError('Введите число от 0 до 99');
      return;
    }

    const startUrl = urlInput.value.trim();
    if (!/^https:\/\/hd\.kinopoisk\.ru\//i.test(startUrl)) {
      setError('Ссылка должна вести на https://hd.kinopoisk.ru/');
      return;
    }

    const payload: KpSavePayload = {
      episodeLimit: limit,
      startUrl,
      start: state.mode === 'start',
    };

    submitButton.disabled = true;
    try {
      const result = await window.kp.save(payload);
      if (!result.ok) {
        setError(result.error ?? 'Не удалось сохранить настройки');
      }
    } finally {
      submitButton.disabled = false;
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
