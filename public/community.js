'use strict';

(function () {
  const state = {
    config: null,
    user: null,
    subscription: null,
    suggestionIndex: -1,
    suggestions: [],
    suggestTimer: null,
    suggestController: null,
    feedbackAdded: false,
    accountCtaAdded: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function lang() {
    return localStorage.getItem('water_lang') === 'es' || document.documentElement.lang === 'es' ? 'es' : 'en';
  }

  function t(en, es) {
    return lang() === 'es' ? (es || en) : en;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : (options.headers || {})
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function setStatus(element, text, kind = '') {
    if (!element) return;
    element.textContent = text || '';
    element.className = `form-status${kind ? ` ${kind}` : ''}`;
  }

  function ga(name, params = {}) {
    if (typeof window.gtag === 'function') window.gtag('event', name, { event_category: 'community', ...params });
  }

  async function loadCommunityState() {
    try {
      state.config = await api('/api/community/config');
    } catch {
      state.config = { accounts_enabled: false, google_enabled: false, mailing_enabled: false, contact_enabled: false };
    }
    try {
      const me = await api('/api/auth/me');
      state.user = me.user || null;
      state.subscription = me.subscription || null;
    } catch {
      state.user = null;
      state.subscription = null;
    }
  }

  function accountLabel() {
    if (!state.user) return t('Sign in', 'Ingresar');
    const first = String(state.user.name || '').trim().split(/\s+/)[0];
    return first || t('My account', 'Mi cuenta');
  }

  function accountLinkMarkup() {
    const picture = state.user?.picture ? `<img src="${esc(state.user.picture)}" alt="">` : '';
    return `<a class="community-account-link" href="/account.html">${picture}<span>${esc(accountLabel())}</span></a>`;
  }

  function addCommunityNavLinks() {
    const navLinks = $('.resident-nav .nav-links');
    if (navLinks && !navLinks.querySelector('[data-community-nav]')) {
      navLinks.insertAdjacentHTML('beforeend', `<span data-community-nav class="community-nav-tools"><a href="/contact.html">${t('Contact', 'Contacto')}</a>${accountLinkMarkup()}</span>`);
      return;
    }
    const tools = $('.community-topbar-links');
    if (tools && !tools.querySelector('.community-account-link')) tools.insertAdjacentHTML('beforeend', accountLinkMarkup());
  }

  // ------------------------- Address autocomplete -------------------------
  function initAddressAutocomplete() {
    const input = $('#address');
    const city = $('#city');
    if (!input || input.dataset.autocompleteReady) return;
    input.dataset.autocompleteReady = '1';
    input.removeAttribute('placeholder');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'address-suggestions');

    const label = input.closest('label');
    if (label) {
      label.classList.add('address-field-wrap');
      label.insertAdjacentHTML('beforeend', `<span class="address-help">${t('Start typing your street address and choose a match below.', 'Empiece a escribir su dirección y elija una coincidencia.')}</span><div id="address-suggestions" class="address-suggestions" role="listbox" aria-label="${t('Address suggestions', 'Sugerencias de dirección')}" hidden></div>`);
    }
    const list = $('#address-suggestions');
    if (!list) return;

    function closeList() {
      state.suggestions = [];
      state.suggestionIndex = -1;
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function selectSuggestion(index) {
      const item = state.suggestions[index];
      if (!item) return;
      input.value = item.street || item.label || '';
      if (city && item.city) city.value = item.city;
      closeList();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      city?.dispatchEvent(new Event('change', { bubbles: true }));
      ga('address_suggestion_selected', { event_label: item.city || '' });
    }

    function renderSuggestions(items) {
      state.suggestions = items;
      state.suggestionIndex = -1;
      if (!items.length) return closeList();
      list.innerHTML = items.map((item, index) => `<button type="button" class="address-suggestion" role="option" id="address-option-${index}" data-index="${index}" aria-selected="false"><span class="address-suggestion-icon" aria-hidden="true">⌖</span><span class="address-suggestion-text"><strong>${esc(item.street || item.label)}</strong><span>${esc(item.label || item.city || '')}</span></span></button>`).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      list.querySelectorAll('.address-suggestion').forEach(button => button.addEventListener('mousedown', event => {
        event.preventDefault();
        selectSuggestion(Number(button.dataset.index));
      }));
    }

    function highlight(index) {
      if (!state.suggestions.length) return;
      state.suggestionIndex = Math.max(0, Math.min(index, state.suggestions.length - 1));
      list.querySelectorAll('.address-suggestion').forEach((button, i) => button.setAttribute('aria-selected', i === state.suggestionIndex ? 'true' : 'false'));
      const active = $(`#address-option-${state.suggestionIndex}`);
      if (active) {
        input.setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest' });
      }
    }

    async function searchSuggestions() {
      const query = input.value.trim();
      if (query.length < 3) return closeList();
      state.suggestController?.abort();
      state.suggestController = new AbortController();
      try {
        const params = new URLSearchParams({ q: query });
        if (city?.value.trim()) params.set('city', city.value.trim());
        const response = await fetch(`/api/address-suggest?${params}`, { signal: state.suggestController.signal, credentials: 'same-origin' });
        if (!response.ok) return closeList();
        const data = await response.json();
        if (input.value.trim() !== query) return;
        renderSuggestions(data.suggestions || []);
      } catch (error) {
        if (error.name !== 'AbortError') closeList();
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(state.suggestTimer);
      state.suggestTimer = setTimeout(searchSuggestions, 230);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && state.suggestions.length) { event.preventDefault(); highlight(state.suggestionIndex + 1); }
      else if (event.key === 'ArrowUp' && state.suggestions.length) { event.preventDefault(); highlight(state.suggestionIndex <= 0 ? state.suggestions.length - 1 : state.suggestionIndex - 1); }
      else if (event.key === 'Enter' && state.suggestionIndex >= 0) { event.preventDefault(); selectSuggestion(state.suggestionIndex); }
      else if (event.key === 'Escape') closeList();
    });
    input.addEventListener('blur', () => setTimeout(closeList, 140));
    document.addEventListener('click', event => { if (!label?.contains(event.target)) closeList(); });
  }

  // ------------------------- Home newsletter ------------------------------
  function newsletterMarkup() {
    return `<section id="water-updates" class="newsletter-card" aria-labelledby="water-updates-title">
      <p class="section-kicker">${t('STAY INFORMED', 'MANTÉNGASE INFORMADO')}</p>
      <h2 id="water-updates-title">${t('Get Seminole County water updates', 'Reciba actualizaciones del agua del Condado de Seminole')}</h2>
      <p>${t('Choose a weekly or monthly email with water-quality information, local alerts, and useful community updates. You can unsubscribe anytime.', 'Elija un correo semanal o mensual con información de calidad del agua, alertas locales y actualizaciones útiles. Puede cancelar en cualquier momento.')}</p>
      <form id="home-newsletter-form" class="newsletter-form">
        <label><span>${t('Email', 'Correo electrónico')}</span><input id="home-newsletter-email" type="email" autocomplete="email" required value="${esc(state.user?.email || '')}"></label>
        <label><span>${t('How often?', '¿Con qué frecuencia?')}</span><select id="home-newsletter-frequency"><option value="monthly">${t('Monthly', 'Mensual')}</option><option value="weekly">${t('Weekly', 'Semanal')}</option></select></label>
        <label><span>${t('Send me', 'Envíeme')}</span><select id="home-newsletter-content"><option value="both">${t('Reports + alerts & updates', 'Informes + alertas y novedades')}</option><option value="water-report">${t('Water-quality reports', 'Informes de calidad del agua')}</option><option value="alerts-media">${t('Alerts & community updates', 'Alertas y novedades')}</option></select></label>
        <button type="submit" class="primary-button">${t('Sign me up', 'Inscribirme')}</button>
      </form>
      <p id="home-newsletter-status" class="form-status" aria-live="polite"></p>
    </section>`;
  }

  function initHomeNewsletter() {
    if (!$('#form') || $('#water-updates')) return;
    const target = $('.public-service-note') || $('footer.site-footer');
    if (target) target.insertAdjacentHTML('beforebegin', newsletterMarkup());
    $('#home-newsletter-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const status = $('#home-newsletter-status');
      setStatus(status, t('Signing you up…', 'Inscribiéndole…'));
      try {
        const city = $('#city')?.value.trim() || '';
        const data = await api('/api/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            email: $('#home-newsletter-email').value,
            frequency: $('#home-newsletter-frequency').value,
            content_type: $('#home-newsletter-content').value,
            city
          })
        });
        setStatus(status, t(`You're signed up for ${data.frequency} updates.`, `Está inscrito para actualizaciones ${data.frequency === 'weekly' ? 'semanales' : 'mensuales'}.`), 'success');
        ga('water_updates_subscribed', { event_label: data.frequency });
      } catch (error) { setStatus(status, error.message, 'error'); }
    });
  }

  // ----------------------- Lookup follow-up -------------------------------
  function addLookupFollowup() {
    const report = $('#resident-action-report');
    const out = $('#out');
    if (!report || !out) return;
    if (!state.feedbackAdded) {
      report.insertAdjacentHTML('beforeend', `<div class="lookup-feedback" id="lookup-feedback"><p>${t('Did this help you understand what to do about your water?', '¿Esto le ayudó a entender qué hacer con su agua?')}</p><div class="feedback-buttons"><button type="button" data-helpful="true">${t('Yes', 'Sí')}</button><button type="button" data-helpful="false">${t('Not yet', 'Aún no')}</button></div></div>`);
      state.feedbackAdded = true;
      $('#lookup-feedback')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-helpful]');
        if (!button) return;
        try {
          await api('/api/feedback', { method: 'POST', body: JSON.stringify({ helpful: button.dataset.helpful === 'true', city: $('#city')?.value || '' }) });
          $('#lookup-feedback').innerHTML = `<p>${t('Thanks — your response was counted.', 'Gracias — su respuesta fue registrada.')}</p>`;
          ga('lookup_feedback', { event_label: button.dataset.helpful });
        } catch { $('#lookup-feedback').innerHTML = `<p>${t('Thanks for the feedback.', 'Gracias por sus comentarios.')}</p>`; }
      });
    }
    if (!state.user && !state.accountCtaAdded) {
      report.insertAdjacentHTML('beforeend', `<div class="account-cta" id="lookup-account-cta"><div><h3>${t('Want to keep up with your water?', '¿Quiere mantenerse al día con su agua?')}</h3><p>${t('Create a free account to manage your email updates and preferences in one place.', 'Cree una cuenta gratuita para administrar sus actualizaciones y preferencias.')}</p></div><a class="primary-button" href="/account.html?from=lookup">${t('Create free account', 'Crear cuenta gratuita')}</a></div>`);
      state.accountCtaAdded = true;
    }
  }

  function initLookupObserver() {
    const out = $('#out');
    if (!out) return;
    const observer = new MutationObserver(() => addLookupFollowup());
    observer.observe(out, { childList: true, subtree: true });
  }

  // Intercept the roadmap's old analytics-only anonymous report and persist it.
  function initAnonymousIssueReporting() {
    document.addEventListener('submit', async event => {
      if (event.target?.id !== 'resident-problem-form') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = $('#resident-problem-status');
      const rawIssue = $('#resident-problem')?.value || '';
      const cityKey = $('#resident-city')?.value || '';
      const map = {
        brown: 'cloudy-discolored', cloudy: 'cloudy-discolored', chlorine: 'chlorine-smell', sulfur: 'sulfur-smell',
        metallic: 'metallic-taste', pressure: 'low-pressure', lead: 'lead-old-home', well: 'private-well',
        boil: 'boil-alert', pfas: 'pfas', dioxane: 'dioxane'
      };
      try {
        await api('/api/report-issue', { method: 'POST', body: JSON.stringify({ issue_type: map[rawIssue] || 'other', city: cityKey }) });
        setStatus(status, t('Thank you. Your anonymous report was counted. No street address was saved with this report.', 'Gracias. Su informe anónimo fue registrado. No se guardó una dirección con este informe.'), 'success');
        event.target.reset();
        ga('resident_issue_saved', { event_label: `${rawIssue}|${cityKey}` });
      } catch (error) { setStatus(status, error.message, 'error'); }
    }, true);
  }

  // ----------------------------- Google -----------------------------------
  function loadGoogleScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const existing = document.querySelector('script[data-google-identity]');
      if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = '1';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderGoogleButton(container) {
    if (!container) return;
    if (!state.config?.google_enabled || !state.config?.google_client_id) {
      container.innerHTML = `<p class="google-not-configured">${t('Google sign-in will appear when it is enabled for this site.', 'El ingreso con Google aparecerá cuando esté habilitado para este sitio.')}</p>`;
      return;
    }
    try {
      await loadGoogleScript();
      window.google.accounts.id.initialize({
        client_id: state.config.google_client_id,
        callback: async response => {
          try {
            const data = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
            state.user = data.user;
            ga('account_google_signed_in');
            location.reload();
          } catch (error) { setStatus($('#account-status'), error.message, 'error'); }
        }
      });
      container.innerHTML = '';
      window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', width: Math.min(360, container.clientWidth || 360), text: 'continue_with' });
    } catch {
      container.innerHTML = `<p class="google-not-configured">${t('Google sign-in could not load. You can still use email.', 'Google no pudo cargar. Aún puede usar correo electrónico.')}</p>`;
    }
  }

  // ----------------------------- Account page -----------------------------
  function signupCard() {
    return `<section class="auth-card"><h2>${t('Create your free account', 'Cree su cuenta gratuita')}</h2><p>${t('Manage water updates and preferences without re-entering them every time.', 'Administre actualizaciones y preferencias sin volver a ingresarlas cada vez.')}</p><div id="google-signup" class="google-area"></div><div class="auth-divider">${t('or use email', 'o use correo')}</div><form id="signup-form" class="community-form"><label><span>${t('Name', 'Nombre')}</span><input id="signup-name" autocomplete="name" maxlength="100" required></label><label><span>${t('Email', 'Correo')}</span><input id="signup-email" type="email" autocomplete="email" required></label><label><span>${t('Password', 'Contraseña')}</span><input id="signup-password" type="password" autocomplete="new-password" minlength="8" required><small>${t('At least 8 characters', 'Al menos 8 caracteres')}</small></label><div class="newsletter-options"><label class="checkbox-line"><input id="signup-updates" type="checkbox" checked><span>${t('Also send me useful Seminole County water updates.', 'También envíeme actualizaciones útiles del agua del Condado de Seminole.')}</span></label><label><span>${t('Email frequency', 'Frecuencia')}</span><select id="signup-frequency"><option value="monthly">${t('Monthly', 'Mensual')}</option><option value="weekly">${t('Weekly', 'Semanal')}</option></select></label></div><button class="primary-button" type="submit">${t('Create account', 'Crear cuenta')}</button></form></section>`;
  }

  function loginCard() {
    return `<section class="auth-card"><h2>${t('Sign in', 'Ingresar')}</h2><p>${t('Welcome back.', 'Bienvenido de nuevo.')}</p><div id="google-login" class="google-area"></div><div class="auth-divider">${t('or use email', 'o use correo')}</div><form id="login-form" class="community-form"><label><span>${t('Email', 'Correo')}</span><input id="login-email" type="email" autocomplete="email" required></label><label><span>${t('Password', 'Contraseña')}</span><input id="login-password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit">${t('Sign in', 'Ingresar')}</button><button class="small-link-button" type="button" id="forgot-toggle">${t('Forgot your password?', '¿Olvidó su contraseña?')}</button></form><form id="forgot-form" class="community-form" hidden><label><span>${t('Account email', 'Correo de la cuenta')}</span><input id="forgot-email" type="email" autocomplete="email" required></label><button class="primary-button" type="submit">${t('Send reset link', 'Enviar enlace')}</button><button class="small-link-button" type="button" id="back-login">${t('Back to sign in', 'Volver a ingresar')}</button></form></section>`;
  }

  function profileCard() {
    const initial = esc((state.user.name || state.user.email || '?')[0].toUpperCase());
    const avatar = state.user.picture ? `<img class="profile-avatar" src="${esc(state.user.picture)}" alt="">` : `<div class="profile-avatar">${initial}</div>`;
    const sub = state.subscription || {};
    return `<section class="community-card profile-card"><div class="profile-head">${avatar}<div><h2>${esc(state.user.name || t('Your account', 'Su cuenta'))}</h2><p>${esc(state.user.email)}</p><span class="${state.user.email_verified ? 'verified-pill' : 'unverified-pill'}">${state.user.email_verified ? t('Email verified', 'Correo verificado') : t('Email not verified', 'Correo no verificado')}</span></div></div>${!state.user.email_verified ? `<div class="success-panel"><strong>${t('Verify your email', 'Verifique su correo')}</strong><p>${t('Verification helps keep account counts accurate and protects your account.', 'La verificación ayuda a mantener preciso el conteo de cuentas y protege su cuenta.')}</p><button id="resend-verification" class="small-link-button" type="button">${t('Send another verification email', 'Enviar otro correo de verificación')}</button></div>` : ''}<div><h3>${t('Water email preferences', 'Preferencias de correos del agua')}</h3><form id="preferences-form" class="community-form"><div class="preferences-grid"><label><span>${t('How often?', '¿Con qué frecuencia?')}</span><select id="pref-frequency"><option value="none"${!sub.active ? ' selected' : ''}>${t('No emails', 'Sin correos')}</option><option value="monthly"${sub.frequency === 'monthly' ? ' selected' : ''}>${t('Monthly', 'Mensual')}</option><option value="weekly"${sub.frequency === 'weekly' ? ' selected' : ''}>${t('Weekly', 'Semanal')}</option></select></label><label><span>${t('Send me', 'Envíeme')}</span><select id="pref-content"><option value="both"${sub.content_type === 'both' ? ' selected' : ''}>${t('Reports + alerts & updates', 'Informes + alertas y novedades')}</option><option value="water-report"${sub.content_type === 'water-report' ? ' selected' : ''}>${t('Water-quality reports', 'Informes de calidad')}</option><option value="alerts-media"${sub.content_type === 'alerts-media' ? ' selected' : ''}>${t('Alerts & community updates', 'Alertas y novedades')}</option></select></label></div><label><span>${t('Community (optional)', 'Comunidad (opcional)')}</span><input id="pref-city" value="${esc(sub.city || '')}" autocomplete="address-level2"></label><button class="primary-button" type="submit">${t('Save preferences', 'Guardar preferencias')}</button></form></div><div><button id="logout-button" class="primary-button" type="button">${t('Sign out', 'Cerrar sesión')}</button></div><div class="danger-zone"><h3>${t('Delete account', 'Eliminar cuenta')}</h3><p>${t('This permanently removes your account and sign-in sessions.', 'Esto elimina permanentemente su cuenta y sesiones.')}</p><button id="delete-account" class="danger-button" type="button">${t('Delete my account', 'Eliminar mi cuenta')}</button></div></section>`;
  }

  async function initAccountPage() {
    const root = $('#account-root');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    const verification = params.get('verified');
    root.innerHTML = `<div id="account-status" class="form-status${verification === '1' ? ' success' : verification === '0' ? ' error' : ''}">${verification === '1' ? t('Email verified. Your account is ready.', 'Correo verificado. Su cuenta está lista.') : verification === '0' ? t('That verification link is invalid or expired.', 'Ese enlace de verificación no es válido o venció.') : ''}</div>${state.user ? profileCard() : `<div class="auth-layout">${signupCard()}${loginCard()}</div>`}`;

    if (!state.user) {
      renderGoogleButton($('#google-signup'));
      renderGoogleButton($('#google-login'));
      $('#signup-form')?.addEventListener('submit', async event => {
        event.preventDefault(); const status = $('#account-status'); setStatus(status, t('Creating account…', 'Creando cuenta…'));
        try {
          const updates = $('#signup-updates').checked;
          const data = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: $('#signup-name').value, email: $('#signup-email').value, password: $('#signup-password').value, newsletter_frequency: updates ? $('#signup-frequency').value : 'none', content_type: 'both' }) });
          state.user = data.user; ga('account_created', { event_label: 'email' }); location.href = '/account.html?created=1';
        } catch (error) { setStatus(status, error.message, 'error'); }
      });
      $('#login-form')?.addEventListener('submit', async event => {
        event.preventDefault(); const status = $('#account-status'); setStatus(status, t('Signing in…', 'Ingresando…'));
        try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) }); state.user = data.user; ga('account_signed_in', { event_label: 'email' }); location.reload(); }
        catch (error) { setStatus(status, error.message, 'error'); }
      });
      $('#forgot-toggle')?.addEventListener('click', () => { $('#login-form').hidden = true; $('#forgot-form').hidden = false; $('#forgot-email').value = $('#login-email').value; });
      $('#back-login')?.addEventListener('click', () => { $('#forgot-form').hidden = true; $('#login-form').hidden = false; });
      $('#forgot-form')?.addEventListener('submit', async event => {
        event.preventDefault(); const status = $('#account-status');
        try { const data = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: $('#forgot-email').value }) }); setStatus(status, data.message, 'success'); }
        catch (error) { setStatus(status, error.message, 'error'); }
      });
      return;
    }

    $('#resend-verification')?.addEventListener('click', async () => {
      const status = $('#account-status');
      try { await api('/api/auth/resend-verification', { method: 'POST', body: '{}' }); setStatus(status, t('Verification email sent.', 'Correo de verificación enviado.'), 'success'); }
      catch (error) { setStatus(status, error.message, 'error'); }
    });
    $('#preferences-form')?.addEventListener('submit', async event => {
      event.preventDefault(); const status = $('#account-status');
      try { await api('/api/auth/preferences', { method: 'POST', body: JSON.stringify({ frequency: $('#pref-frequency').value, content_type: $('#pref-content').value, city: $('#pref-city').value }) }); setStatus(status, t('Preferences saved.', 'Preferencias guardadas.'), 'success'); ga('account_preferences_saved'); }
      catch (error) { setStatus(status, error.message, 'error'); }
    });
    $('#logout-button')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.href = '/'; });
    $('#delete-account')?.addEventListener('click', async () => {
      if (!confirm(t('Permanently delete your account?', '¿Eliminar permanentemente su cuenta?'))) return;
      const status = $('#account-status');
      try { await api('/api/auth/account', { method: 'DELETE' }); ga('account_deleted'); location.href = '/'; }
      catch (error) { setStatus(status, error.message, 'error'); }
    });
  }

  // ------------------------------ Contact ---------------------------------
  async function initContactPage() {
    const form = $('#contact-form');
    if (!form) return;
    if (state.user) { $('#contact-name').value = state.user.name || ''; $('#contact-email').value = state.user.email || ''; }
    const updateFields = () => { const box = $('#contact-newsletter-options'); if (box) box.hidden = !$('#contact-newsletter').checked; };
    $('#contact-newsletter')?.addEventListener('change', updateFields); updateFields();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const status = $('#contact-status'); setStatus(status, t('Sending…', 'Enviando…'));
      try {
        const data = await api('/api/contact', { method: 'POST', body: JSON.stringify({
          name: $('#contact-name').value, email: $('#contact-email').value, subject: $('#contact-subject').value,
          message: $('#contact-message').value, website: $('#contact-website').value,
          newsletter: $('#contact-newsletter').checked, frequency: $('#contact-frequency').value,
          content_type: $('#contact-content').value, city: $('#contact-city').value
        }) });
        setStatus(status, data.message || t('Your message was sent.', 'Su mensaje fue enviado.'), 'success');
        $('#contact-message').value = ''; ga('contact_message_sent');
      } catch (error) { setStatus(status, error.message, 'error'); }
    });
  }

  // ------------------------- Reset / unsubscribe ---------------------------
  function initResetPage() {
    const form = $('#reset-password-form'); if (!form) return;
    const token = new URLSearchParams(location.search).get('token') || '';
    if (!token) setStatus($('#reset-status'), t('This reset link is missing its token.', 'A este enlace le falta el código.'), 'error');
    form.addEventListener('submit', async event => {
      event.preventDefault(); const status = $('#reset-status');
      const password = $('#reset-password').value, confirmPassword = $('#reset-password-confirm').value;
      if (password !== confirmPassword) return setStatus(status, t('Passwords do not match.', 'Las contraseñas no coinciden.'), 'error');
      try { await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }); setStatus(status, t('Password changed. You are signed in.', 'Contraseña cambiada. Ha iniciado sesión.'), 'success'); setTimeout(() => { location.href = '/account.html'; }, 900); }
      catch (error) { setStatus(status, error.message, 'error'); }
    });
  }

  async function initUnsubscribePage() {
    const root = $('#unsubscribe-root'); if (!root) return;
    const token = new URLSearchParams(location.search).get('token') || '';
    if (!token) { root.innerHTML = `<div class="success-panel"><h2>${t('Invalid unsubscribe link', 'Enlace no válido')}</h2><p>${t('The link is incomplete.', 'El enlace está incompleto.')}</p></div>`; return; }
    try { await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ token }) }); root.innerHTML = `<div class="success-panel"><h2>${t('You are unsubscribed.', 'Ha cancelado la suscripción.')}</h2><p>${t('You will no longer receive these water update emails.', 'Ya no recibirá estos correos de actualización.')}</p><p><a href="/">${t('Return to water check', 'Volver a revisar el agua')}</a></p></div>`; }
    catch (error) { root.innerHTML = `<div class="success-panel"><h2>${t('Could not change this subscription', 'No se pudo cambiar esta suscripción')}</h2><p>${esc(error.message)}</p></div>`; }
  }

  // ----------------------------- Impact -----------------------------------
  async function augmentImpactPage() {
    if (document.body.dataset.page !== 'impact') return;
    const root = $('#page-root'); if (!root) return;
    try {
      const data = await api('/api/community/impact');
      const stats = `<section class="community-card" id="community-impact-stats"><p class="section-kicker">${t('COMMUNITY GROWTH', 'CRECIMIENTO DE LA COMUNIDAD')}</p><h2>${t('People choosing to stay connected', 'Personas que eligen mantenerse conectadas')}</h2><div class="impact-account-stats"><div><strong>${Number(data.accounts || 0).toLocaleString()}</strong><span>${t('accounts created', 'cuentas creadas')}</span></div><div><strong>${Number(data.verified_accounts || 0).toLocaleString()}</strong><span>${t('verified accounts', 'cuentas verificadas')}</span></div><div><strong>${Number(data.subscribers || 0).toLocaleString()}</strong><span>${t('water update subscribers', 'suscriptores de actualizaciones')}</span></div><div><strong>${data.helpful_percent == null ? '—' : `${data.helpful_percent}%`}</strong><span>${t('said the tool helped', 'dijeron que ayudó')}</span></div></div><p>${t('Only aggregate counts are shown here. Email addresses, names, messages, and household details are never displayed on the public dashboard.', 'Aquí solo se muestran totales. Los correos, nombres, mensajes y datos del hogar nunca aparecen en el panel público.')}</p></section>`;
      root.insertAdjacentHTML('beforeend', stats);
    } catch {}
  }

  async function init() {
    await loadCommunityState();
    addCommunityNavLinks();
    initAddressAutocomplete();
    initHomeNewsletter();
    initLookupObserver();
    initAnonymousIssueReporting();
    await initAccountPage();
    await initContactPage();
    initResetPage();
    await initUnsubscribePage();
    await augmentImpactPage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
