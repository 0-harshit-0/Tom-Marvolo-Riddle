export function randomId(type = 'default') {
  if (type == 'default') return (Date.now() + Math.random()).toString();
  // add the crypto type and use that
  // add the uuid type and use that
}

export async function talkToDiary(userText) {
  const url = 'https://0harshit0.pythonanywhere.com/ask-diary';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: userText }),
    });

    if (!response.ok) {
      throw new Error('The diary remains silent...');
    }

    const data = await response.json();

    // This is the string Tom Riddle "wrote" back
    console.log(data.reply);
    return data.reply;
  } catch (error) {
    console.error('Magic Error:', error);
    return 'The ink fades before it can form words...';
  }
}
