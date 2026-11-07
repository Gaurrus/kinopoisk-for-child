(() => {
  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Element #${id} not found`);
    return element as T;
  };

  const screens = {
    loading: byId<HTMLElement>('screen-loading'),
    locked: byId<HTMLElement>('screen-locked'),
    pin: byId<HTMLElement>('screen-pin'),
    form: byId<HTMLElement>('screen-form'),
  };

  const lockedLimit = byId<HTMLElement>('locked-limit');
  const btnWatch = byId<HTMLButtonElement>('btn-watch');
  const btnEdit = byId<HTMLButtonElement>('btn-edit');

  const pinForm = byId<HTMLFormElement>('pin-form');
  const pinInput = byId<HTMLInputElement>('pin-input');
  const pinError = byId<HTMLParagraphElement>('pin-error');
  const pinBack = byId<HTMLButtonElement>('pin-back');

  const settingsForm = byId<HTMLFormElement>('settings-form');
  const limitInput = byId<HTMLInputElement>('limit-input');
  const urlInput = byId<HTMLInputElement>('url-input');
  const pinField = byId<HTMLInputElement>('pin-field');
  const pinLabel = byId<HTMLElement>('pin-label');
  const formError = byId<HTMLParagraphElement>('form-error');
  const submitButton = byId<HTMLButtonElement>('submit-button');
  const formEyebrow = byId<HTMLElement>('form-eyebrow');
  const formTitle = byId<HTMLElement>('form-title');

  const authStatus = byId<HTMLElement>('auth-status');
  const btnLogout = byId<HTMLButtonElement>('btn-logout');
  const version = byId<HTMLElement>('version');

  let state: KpSettingsState | null = null;
  let forceForm = false;

  function show(name: keyof typeof screens): void {
    for (const [key, element] of Object.entries(screens)) {
      element.hidden = key !== name;
    }
  }

  function setError(element: HTMLElement, message: string | null): void {
    element.textContent = message ?? '';
    element.hidden = message === null;
  }

  function fillForm(current: KpSettingsState): void {
    limitInput.value = String(current.episodeLimit);
    urlInput.value = current.startUrl;
    pinField.value = '';
    pinLabel.textContent = current.hasPin
      ? 'Новый PIN (оставьте пустым, чтобы не менять)'
      : 'PIN для родителей (необязательно)';
    formEyebrow.textContent = current.mode === 'start' ? 'Перед началом' : 'Настройки';
    formTitle.textContent = current.mode === 'start' ? 'Сколько серий разрешить?' : 'Настройки просмотра';
    submitButton.textContent =
      current.mode === 'start' ? 'Начать просмотр' : 'Сохранить и вернуться';
    setError(formError, null);
  }

  function renderAuth(current: KpSettingsState): void {
    if (current.auth.loggedIn) {
      const login = current.auth.login ? ` (${current.auth.login})` : '';
      authStatus.textContent = `Аккаунт: вход выполнен${login}`;
      authStatus.style.color = '#7fe0a8';
    } else {
      authStatus.textContent = 'Аккаунт: вход не выполнен — войдите в окне Кинопоиска';
      authStatus.style.color = '';
    }
  }

  function render(): void {
    if (!state) return;

    lockedLimit.textContent = String(state.episodeLimit);
    renderAuth(state);

    if (state.mode === 'start' && state.hasPin && !forceForm) {
      show('locked');
      return;
    }

    if (state.hasPin && !state.unlocked) {
      setError(pinError, null);
      pinInput.value = '';
      show('pin');
      pinInput.focus();
      return;
    }

    fillForm(state);
    show('form');
  }

  async function refresh(): Promise<void> {
    state = await window.kp.getState();
    version.textContent = `v0.1.0`;
    render();
  }

  function requestPinScreen(): void {
    if (!state) return;
    forceForm = true;
    render();
  }

  btnWatch.addEventListener('click', async () => {
    btnWatch.disabled = true;
    try {
      const result = await window.kp.start();
      if (!result.ok) {
        btnWatch.disabled = false;
      }
    } catch {
      btnWatch.disabled = false;
    }
  });

  btnEdit.addEventListener('click', () => {
    requestPinScreen();
  });

  pinBack.addEventListener('click', () => {
    if (!state) return;
    forceForm = false;
    render();
  });

  pinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state) return;

    setError(pinError, null);
    const pin = pinInput.value.trim();
    if (pin.length === 0) {
      setError(pinError, 'Введите PIN');
      return;
    }

    const result = await window.kp.verifyPin(pin);
    if (!result.ok) {
      setError(pinError, result.error ?? 'Неверный PIN');
      pinInput.select();
      return;
    }

    state = { ...state, unlocked: true };
    forceForm = true;
    render();
  });

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state) return;

    setError(formError, null);

    const rawLimit = limitInput.value.trim();
    const limit = rawLimit === '' ? Number.NaN : Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 0 || limit > 99) {
      setError(formError, 'Введите число от 0 до 99');
      return;
    }

    const startUrl = urlInput.value.trim();
    if (!/^https:\/\/hd\.kinopoisk\.ru\//i.test(startUrl)) {
      setError(formError, 'Ссылка должна вести на https://hd.kinopoisk.ru/');
      return;
    }

    const pin = pinField.value.trim();
    if (pin.length > 0 && !/^\d{4,8}$/.test(pin)) {
      setError(formError, 'PIN должен состоять из 4–8 цифр');
      return;
    }

    const payload: KpSavePayload = {
      episodeLimit: limit,
      startUrl,
      start: state.mode === 'start',
    };
    if (pin.length > 0) payload.pin = pin;

    submitButton.disabled = true;
    try {
      const result = await window.kp.save(payload);
      if (!result.ok) {
        setError(formError, result.error ?? 'Не удалось сохранить настройки');
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
      setError(formError, result.error ?? 'Не удалось выйти из аккаунта');
    }
  });

  void refresh().catch((error: unknown) => {
    console.error('[settings] failed to load state', error);
    show('form');
  });
})();
