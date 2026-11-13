const ADMIN_KEY = 'coinjar-admin';

async function grant(userId, amount) {
  const res = await fetch('/admin/grant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify({ user_id: userId, amount }),
  });
  return res.json();
}

document.querySelector('#grant-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const result = await grant(Number(form.get('user_id')), Number(form.get('amount')));
  document.querySelector('#result').textContent = JSON.stringify(result);
});
