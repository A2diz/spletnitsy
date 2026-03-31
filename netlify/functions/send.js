const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  const token = process.env.TELEGRAM_TOKEN;
  const chatIds = ['456436881', '-1002450093842'];

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid JSON' };
  }

  const { name, contact, format, fav } = body;
  if (!name || !contact || !format || !fav) {
    return { statusCode: 400, headers: corsHeaders, body: 'Missing fields' };
  }

  const text = `🌸 *Новая заявка в Сплетницы!*\n\n👤 *Имя:* ${name}\n📱 *Telegram/Instagram:* ${contact}\n📍 *Формат:* ${format}\n📚 *Любимая книга/жанр:* ${fav}`;

  try {
    await Promise.all(chatIds.map(id =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text, parse_mode: 'Markdown' })
      })
    ));

    return { statusCode: 200, headers: corsHeaders, body: 'OK' };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: 'Telegram error' };
  }
};
