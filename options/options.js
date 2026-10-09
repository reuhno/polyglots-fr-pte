import { getSettings, saveSettings, resetSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);

function fill(s) {
  $('team').value = s.team.join('\n');
  $('template').value = s.template;
  $('intervalMinutes').value = s.intervalMinutes;
  $('windowDays').value = s.windowDays;
  $('notify').checked = s.notify;
}

function say(text, ms = 4000) {
  $('status').textContent = text;
  clearTimeout(say.timer);
  say.timer = setTimeout(() => { $('status').textContent = ''; }, ms);
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const saved = await saveSettings({
      team: $('team').value.split(/\r?\n/),
      template: $('template').value,
      intervalMinutes: $('intervalMinutes').value,
      windowDays: $('windowDays').value,
      notify: $('notify').checked,
    });
    fill(saved); // reflète les valeurs corrigées (bornes, doublons)
    say('Enregistré.');
  } catch (err) {
    // Par exemple quota de storage.sync dépassé (8 Ko par élément : modèle de réponse trop long).
    say(`Échec de l’enregistrement : ${(err && err.message) || err}`, 15000);
  }
});

$('reset').addEventListener('click', async () => {
  if (!window.confirm('Rétablir tous les réglages par défaut ? La liste des pseudos de l’équipe FR sera vidée.')) return;
  fill(await resetSettings());
  say('Valeurs par défaut rétablies.');
});

getSettings().then(fill);
