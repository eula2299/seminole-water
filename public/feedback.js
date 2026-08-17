'use strict';

(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const params = new URLSearchParams(location.search);

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

  function setStatus(text, kind = '') {
    const el = $('#feedback-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = `form-status${kind ? ` ${kind}` : ''}`;
  }

  function ga(name, values = {}) {
    if (typeof window.gtag === 'function') window.gtag('event', name, { event_category: 'feedback', ...values });
  }

  function safeContext() {
    const from = String(params.get('from') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60);
    const city = String(params.get('city') || '').replace(/[<>\r\n]/g, '').slice(0, 80);
    return { from, city };
  }

  async function prefillAccount() {
    try {
      const data = await api('/api/auth/me');
      if (!data.user) return;
      $('#feedback-name').value = data.user.name || '';
      $('#feedback-email').value = data.user.email || '';
    } catch {}
  }

  async function submit(event) {
    event.preventDefault();
    const rating = Number(document.querySelector('input[name="rating"]:checked')?.value || 0);
    const type = $('#feedback-type').value;
    const rawMessage = $('#feedback-message').value.trim();
    const name = $('#feedback-name').value.trim();
    const email = $('#feedback-email').value.trim();
    const reply = $('#feedback-reply').checked;
    const honeypot = $('#feedback-company').value;
    const context = safeContext();

    if (!type || rating < 1 || rating > 5 || rawMessage.length < 5) {
      return setStatus('Choose a feedback type, rating, and write a short message.', 'error');
    }

    setStatus('Sending your feedback…');
    const typeLabels = {
      'water-result': 'Water result',
      'data-correction': 'Data correction',
      bug: 'Bug',
      account: 'Account / Google sign-in',
      accessibility: 'Accessibility / mobile',
      feature: 'Feature idea',
      other: 'Other'
    };
    const details = [
      `Feedback type: ${typeLabels[type] || type}`,
      `Rating: ${rating}/5`,
      `Reply requested: ${reply ? 'Yes' : 'No'}`,
      context.from ? `Entry point: ${context.from}` : '',
      context.city ? `City: ${context.city}` : '',
      '',
      rawMessage
    ].filter((line, index) => line || index >= 5).join('\n');

    try {
      const response = await api('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          subject: `Website feedback — ${typeLabels[type] || type} — ${rating}/5`,
          message: details,
          website: honeypot,
          newsletter: false
        })
      });

      api('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ helpful: rating >= 4, city: context.city, issue: type })
      }).catch(() => {});

      setStatus(response.message || 'Thank you. Your feedback was sent.', 'success');
      $('#feedback-message').value = '';
      document.querySelectorAll('input[name="rating"]').forEach(input => { input.checked = false; });
      ga('detailed_feedback_sent', { event_label: type, value: rating });
    } catch (error) {
      setStatus(error.message, 'error');
      ga('detailed_feedback_failed', { event_label: type });
    }
  }

  async function init() {
    await prefillAccount();
    const context = safeContext();
    if (context.from === 'water-result') $('#feedback-type').value = 'water-result';
    if (context.from === 'account') $('#feedback-type').value = 'account';
    $('#feedback-form')?.addEventListener('submit', submit);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
