exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = process.env.TELEGRAM_TOKEN;
  const chatIds = ['456436881', '-1002450093842'];

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { name, contact, format, fav } = body;
  if (!name || !contact || !format || !fav) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const text = `🌸 *Новая заявка в Сплетницы!*\n\n👤 *Имя:* ${name}\n📱 *Telegram/Instagram:* ${contact}\n📍 *Формат:* ${format}\n📚 *Любимая книга/жанр:* ${fav}`;

  try {
    const responses = await Promise.all(chatIds.map(id =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text, parse_mode: 'Markdown' })
      })
    ));
    for (const res of responses) {
      if (!res.ok) {
        return { statusCode: 500, body: 'Telegram error: ' + res.status };
      }
    }
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    return { statusCode: 500, body: 'Telegram error' };
  }
};
