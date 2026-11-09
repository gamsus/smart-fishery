const API_URL = 'https://smart-fishery-api.onrender.com/api';

async function setup() {
  console.log('Logowanie do zdalnego API...');
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin123!' })
  });

  if (!loginRes.ok) {
    throw new Error(`Błąd logowania: ${loginRes.status} ${await loginRes.text()}`);
  }

  const { accessToken } = await loginRes.json();
  console.log('Zalogowano pomyślnie.');

  const sensors = [
    { name: 'Sonda Termiczna Zanurzeniowa', seriesId: 1, type: 'temp' },
    { name: 'Barometr Stacja Brzegowa', seriesId: 2, type: 'pressure' },
    { name: 'Oksymetr Sonda Pływająca', seriesId: 3, type: 'oxygen' }
  ];

  for (const s of sensors) {
    const res = await fetch(`${API_URL}/sensors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ name: s.name, seriesId: s.seriesId })
    });

    if (res.status === 201) {
      const data = await res.json();
      console.log(`\nZarejestrowano czujnik: "${data.name}"`);
      console.log(`-> Typ: ${s.type}`);
      console.log(`-> KLUCZ API: ${data.apiKey}`);
    } else {
      console.error(`Błąd rejestracji ${s.name}: ${res.status} ${await res.text()}`);
    }
  }
}

setup().catch(console.error);